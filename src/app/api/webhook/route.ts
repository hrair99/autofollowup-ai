import { NextRequest, NextResponse } from "next/server";
import { normalizeWebhookEvents, verifyWebhook } from "@/lib/meta/webhooks";
import { handleMessengerMessage } from "@/lib/conversation/engine";
import { handleComment } from "@/lib/conversation/commentHandler";
import { handleLeadgen } from "@/lib/conversation/leadgenHandler";
import {
  verifyMetaSignature,
  signatureVerificationBypassed,
} from "@/lib/meta/signature";
import {
  makeRequestId,
  persistWebhookDelivery,
  structuredLog,
  updateDeliveryStatus,
} from "@/lib/observability/webhookLog";
import { commentDedupeKey, enqueueJob } from "@/lib/jobs/queue";
import { resolveBusinessByPage, type BusinessContext } from "@/lib/business/resolve";

// Node runtime required for HMAC verification.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERIFY_TOKEN =
  process.env.META_VERIFY_TOKEN || "autofollowup_verify_token_2024";
const APP_SECRET = process.env.META_APP_SECRET;

// WEBHOOK_INLINE_COMMENTS=true → process comments synchronously (debug mode).
const INLINE_COMMENTS = process.env.WEBHOOK_INLINE_COMMENTS === "true";

// WEBHOOK_QUEUE_MESSAGES=true → enqueue messages to job queue instead of
// processing inline. Safer but adds latency (waits for next cron tick).
const QUEUE_MESSAGES = process.env.WEBHOOK_QUEUE_MESSAGES === "true";

// ============================================
// GET — Meta webhook verification
// ============================================
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const result = verifyWebhook(
    searchParams.get("hub.mode"),
    searchParams.get("hub.verify_token"),
    searchParams.get("hub.challenge"),
    VERIFY_TOKEN
  );
  if (result.valid) {
    console.log("[Webhook] Verification handshake passed");
    return new NextResponse(result.challenge);
  }
  return new NextResponse("Verification failed", { status: 403 });
}

// ============================================
// POST — Fast-ack webhook handler
//
// Design: validate → normalise → enqueue/fire → return 200 ASAP.
// Meta expects a response within ~15 seconds. Our AI reply generation
// can take 3–8 seconds, so we want to decouple acknowledgement from
// processing whenever possible.
//
// • Comments: always enqueued (async via automation_jobs).
// • Messages: processed inline by default (for fast Messenger UX),
//   but can be queued via WEBHOOK_QUEUE_MESSAGES=true.
// • Leadgen: processed inline (fast, no AI needed).
// ============================================
export async function POST(req: NextRequest) {
  const requestId = makeRequestId();
  const rawBody = await req.text();
  const skipSig = signatureVerificationBypassed();

  // --- 1. Signature verification ---
  let signatureVerified = false;
  if (!skipSig) {
    const sigResult = verifyMetaSignature(
      rawBody,
      req.headers.get("x-hub-signature-256"),
      APP_SECRET
    );
    if (!sigResult.valid) {
      structuredLog({
        requestId,
        objectType: null,
        eventTypes: [],
        rawPresent: !!rawBody,
        signatureVerified: false,
        signatureSkipped: false,
        normalizedCount: 0,
        droppedCount: 0,
        dropReasons: ["signature_invalid:" + sigResult.reason],
        status: "rejected",
        error: `sig:${sigResult.reason}`,
      });
      await persistWebhookDelivery({
        requestId,
        objectType: null,
        eventTypes: [],
        rawPresent: !!rawBody,
        signatureVerified: false,
        signatureSkipped: false,
        normalizedCount: 0,
        droppedCount: 0,
        dropReasons: ["signature_invalid:" + sigResult.reason],
        status: "rejected",
        error: sigResult.reason,
        rawBody,
      });
      return NextResponse.json(
        { status: "unauthorized", reason: sigResult.reason, request_id: requestId },
        { status: 401 }
      );
    }
    signatureVerified = true;
  }

  // --- 2. Parse body ---
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch (error) {
    const msg = String(error);
    structuredLog({
      requestId, objectType: null, eventTypes: [],
      rawPresent: !!rawBody, signatureVerified, signatureSkipped: skipSig,
      normalizedCount: 0, droppedCount: 0,
      dropReasons: ["invalid_json"], status: "rejected", error: msg,
    });
    await persistWebhookDelivery({
      requestId, objectType: null, eventTypes: [],
      rawPresent: !!rawBody, signatureVerified, signatureSkipped: skipSig,
      normalizedCount: 0, droppedCount: 0,
      dropReasons: ["invalid_json"], status: "rejected", error: msg, rawBody,
    });
    return NextResponse.json({ status: "bad_request" }, { status: 400 });
  }

  const bodyObj = body as { object?: string };
  const objectType = bodyObj?.object ?? null;

  // --- 3. Normalise events ---
  let events;
  try {
    events = normalizeWebhookEvents(
      body as Parameters<typeof normalizeWebhookEvents>[0]
    );
  } catch (normError) {
    console.error("[Webhook] Normalisation error:", normError);
    await persistWebhookDelivery({
      requestId, objectType, eventTypes: [],
      rawPresent: !!rawBody, signatureVerified, signatureSkipped: skipSig,
      normalizedCount: 0, droppedCount: 0,
      dropReasons: ["normalisation_error"], status: "error",
      error: String(normError), rawBody,
    });
    // Still return 200 — don't make Meta retry a bad payload forever
    return NextResponse.json({ status: "normalisation_error", request_id: requestId });
  }

  const eventTypes = events.map((e) => e.type);

  // --- 4. Persist delivery record (fast, non-blocking) ---
  const deliveryPromise = persistWebhookDelivery({
    requestId, objectType, eventTypes,
    rawPresent: !!rawBody, signatureVerified, signatureSkipped: skipSig,
    normalizedCount: events.length, droppedCount: 0,
    dropReasons: [], status: "received", rawBody,
  }).catch((e) => console.error("[Webhook] delivery persist error:", e));

  structuredLog({
    requestId, objectType, eventTypes,
    rawPresent: !!rawBody, signatureVerified, signatureSkipped: skipSig,
    normalizedCount: events.length, droppedCount: 0,
    dropReasons: [], status: "received",
  });

  if (events.length === 0) {
    await deliveryPromise;
    await updateDeliveryStatus(requestId, { status: "processed" }).catch(() => {});
    return NextResponse.json({ status: "no_events", request_id: requestId });
  }

  // --- 5. Route events (fast-ack: enqueue what we can, inline what we must) ---
  // We collect background promises and let them run after returning the response.
  const backgroundWork: Promise<void>[] = [];
  let processed = 0;
  let enqueued = 0;
  const dropReasons: string[] = [];

  // Business context cache (avoid repeated DB lookups within same batch)
  const bizCache = new Map<string, BusinessContext | null>();
  const getBizCtx = async (pgId: string): Promise<BusinessContext | null> => {
    if (!bizCache.has(pgId)) {
      bizCache.set(pgId, await resolveBusinessByPage(pgId));
    }
    return bizCache.get(pgId) ?? null;
  };

  for (const event of events) {
    try {
      const bizCtx = await getBizCtx(event.pageId);
      if (!bizCtx) {
        dropReasons.push(`no_business:${event.pageId}`);
        console.warn(`[Webhook] No business for page ${event.pageId}, skipping ${event.type}`);
        continue;
      }

      // Skip if business in monitor mode (except leadgen = just storage)
      if (bizCtx.mode === "monitor" && event.type !== "leadgen") {
        dropReasons.push(`monitor_mode:${event.type}`);
        continue;
      }

      if (event.type === "message") {
        if (QUEUE_MESSAGES) {
          // Queue mode: safer, but adds cron-tick latency
          const key = `message:${event.pageId}:${event.platformMessageId || event.senderId + ":" + event.timestamp}`;
          const res = await enqueueJob({
            type: "handle_message",
            dedupeKey: key,
            payload: { event, request_id: requestId, business_id: bizCtx.businessId },
            businessId: bizCtx.businessId,
          });
          if (res.enqueued) enqueued++;
          else dropReasons.push(`enqueue_${res.reason}:message`);
        } else {
          // Inline mode: fire-and-forget for fast Messenger UX.
          // We don't await this — it runs in the background after we return 200.
          backgroundWork.push(
            handleMessengerMessage(event, bizCtx).catch((err) =>
              console.error(`[Webhook] bg message error:`, err)
            )
          );
          processed++;
        }
      } else if (event.type === "leadgen") {
        // Leadgen is fast (no AI), run inline
        backgroundWork.push(
          handleLeadgen(event, bizCtx).catch((err) =>
            console.error(`[Webhook] bg leadgen error:`, err)
          )
        );
        processed++;
      } else if (event.type === "comment") {
        if (INLINE_COMMENTS) {
          backgroundWork.push(
            handleComment(event, bizCtx).catch((err) =>
              console.error(`[Webhook] bg comment error:`, err)
            )
          );
          processed++;
        } else {
          const key = commentDedupeKey(event.pageId, event.commentId || "unknown");
          const res = await enqueueJob({
            type: "handle_comment",
            dedupeKey: key,
            payload: { event, request_id: requestId, business_id: bizCtx.businessId },
            businessId: bizCtx.businessId,
          });
          if (res.enqueued) enqueued++;
          else if (res.reason === "duplicate") {
            dropReasons.push("enqueue_duplicate:" + (event.commentId || "?"));
          } else {
            dropReasons.push("enqueue_error:" + (res.error || "unknown"));
            console.error("[Webhook] enqueue failed:", res.error);
          }
        }
      }
    } catch (eventError) {
      console.error(`[Webhook] Error routing ${event.type}:`, eventError);
      dropReasons.push(`routing_error:${event.type}`);
    }
  }

  // --- 6. Return 200 immediately (fast-ack) ---
  // Background work continues after the response is sent.
  // On Vercel, the function stays alive briefly after response.
  // On self-hosted, this is fine since Node keeps the event loop.
  const response = NextResponse.json({
    status: "ok",
    processed,
    enqueued,
    dropped: dropReasons.length,
    request_id: requestId,
  });

  // Fire-and-forget: update delivery status + let background work finish.
  // We intentionally do NOT await these before returning.
  Promise.all([
    deliveryPromise,
    ...backgroundWork,
  ])
    .then(() =>
      updateDeliveryStatus(requestId, {
        status: "processed",
        droppedCount: dropReasons.length,
        dropReasons,
      })
    )
    .catch((e) => console.error("[Webhook] bg cleanup error:", e));

  return response;
}
