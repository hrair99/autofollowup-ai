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

// Node runtime required for HMAC verification.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERIFY_TOKEN =
  process.env.META_VERIFY_TOKEN || "autofollowup_verify_token_2024";
const APP_SECRET = process.env.META_APP_SECRET;

// Set WEBHOOK_INLINE_COMMENTS=true to process comments synchronously
// inside the webhook handler (handy while debugging). Default: enqueue.
const INLINE_COMMENTS = process.env.WEBHOOK_INLINE_COMMENTS === "true";

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
// POST — Incoming events from Meta (messages + comments)
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
        {
          status: "unauthorized",
          reason: sigResult.reason,
          request_id: requestId,
        },
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
      requestId,
      objectType: null,
      eventTypes: [],
      rawPresent: !!rawBody,
      signatureVerified,
      signatureSkipped: skipSig,
      normalizedCount: 0,
      droppedCount: 0,
      dropReasons: ["invalid_json"],
      status: "rejected",
      error: msg,
    });
    await persistWebhookDelivery({
      requestId,
      objectType: null,
      eventTypes: [],
      rawPresent: !!rawBody,
      signatureVerified,
      signatureSkipped: skipSig,
      normalizedCount: 0,
      droppedCount: 0,
      dropReasons: ["invalid_json"],
      status: "rejected",
      error: msg,
      rawBody,
    });
    return NextResponse.json({ status: "bad_request" }, { status: 400 });
  }

  const bodyObj = body as { object?: string };
  const objectType = bodyObj?.object ?? null;

  // --- 3. Normalise + route ---
  try {
    const events = normalizeWebhookEvents(
      body as Parameters<typeof normalizeWebhookEvents>[0]
    );
    const eventTypes = events.map((e) => e.type);

    await persistWebhookDelivery({
      requestId,
      objectType,
      eventTypes,
      rawPresent: !!rawBody,
      signatureVerified,
      signatureSkipped: skipSig,
      normalizedCount: events.length,
      droppedCount: 0,
      dropReasons: [],
      status: "received",
      rawBody,
    });

    structuredLog({
      requestId,
      objectType,
      eventTypes,
      rawPresent: !!rawBody,
      signatureVerified,
      signatureSkipped: skipSig,
      normalizedCount: events.length,
      droppedCount: 0,
      dropReasons: [],
      status: "received",
    });

    if (events.length === 0) {
      await updateDeliveryStatus(requestId, { status: "processed" });
      return NextResponse.json({
        status: "no_events",
        request_id: requestId,
      });
    }

    let processed = 0;
    let enqueued = 0;
    const dropReasons: string[] = [];

    for (const event of events) {
      try {
        if (event.type === "message") {
          // Messenger remains inline — already reliable.
          await handleMessengerMessage(event);
          processed++;
        } else if (event.type === "leadgen") {
          // Lead ad form submissions — process inline (fast, no AI needed)
          await handleLeadgen(event);
          processed++;
        } else if (event.type === "comment") {
          if (INLINE_COMMENTS) {
            await handleComment(event);
            processed++;
          } else {
            const key = commentDedupeKey(
              event.pageId,
              event.commentId || "unknown"
            );
            const res = await enqueueJob({
              type: "handle_comment",
              dedupeKey: key,
              payload: { event, request_id: requestId },
            });
            if (res.enqueued) enqueued++;
            else if (res.reason === "duplicate") {
              dropReasons.push(
                "enqueue_duplicate:" + (event.commentId || "?")
              );
            } else {
              dropReasons.push(
                "enqueue_error:" + (res.error || "unknown")
              );
              console.error("[Webhook] enqueue failed:", res.error);
            }
          }
        }
      } catch (eventError) {
        console.error(
          `[Webhook] Error processing ${event.type} event:`,
          eventError
        );
        dropReasons.push(`processing_error:${event.type}`);
      }
    }

    await updateDeliveryStatus(requestId, {
      status: "processed",
      droppedCount: dropReasons.length,
      dropReasons,
    });

    return NextResponse.json({
      status: "ok",
      processed,
      enqueued,
      dropped: dropReasons.length,
      request_id: requestId,
    });
  } catch (error) {
    const msg = String(error);
    console.error("[Webhook] Error