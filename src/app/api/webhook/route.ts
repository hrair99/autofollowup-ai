import { NextRequest, NextResponse } from "next/server";
import { normalizeWebhookEvents, verifyWebhook } from "@/lib/meta/webhooks";
import { handleMessengerMessage } from "@/lib/conversation/engine";
import { handleComment } from "@/lib/conversation/commentHandler";
import {
  verifyMetaSignature,
  signatureVerificationBypassed,
} from "@/lib/meta/signature";

// Use the Node.js runtime so `crypto` is available for HMAC verification.
export const runtime = "nodejs";
// Prevent Next from caching POSTs and ensure body streaming works predictably.
export const dynamic = "force-dynamic";

const VERIFY_TOKEN =
  process.env.META_VERIFY_TOKEN || "autofollowup_verify_token_2024";
const APP_SECRET = process.env.META_APP_SECRET;

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
  // Read the body as raw text so we can both (a) verify the HMAC
  // signature over the exact bytes Meta sent and (b) parse as JSON.
  // NextRequest.json() would re-parse and lose whitespace.
  const rawBody = await req.text();

  // --- 1. Signature verification ---
  // Allow a dev/local bypass via META_SKIP_SIGNATURE_CHECK=true; otherwise
  // we strictly require the header to match.
  if (!signatureVerificationBypassed()) {
    const sigResult = verifyMetaSignature(
      rawBody,
      req.headers.get("x-hub-signature-256"),
      APP_SECRET
    );
    if (!sigResult.valid) {
      console.warn(
        `[Webhook] Signature check failed: ${sigResult.reason}. ` +
          `Rejecting request.`
      );
      // 401 (not 200) — we *want* Meta to know this was refused so that
      // legitimate deliveries that legitimately fail verification show up
      // in the app's delivery log rather than getting silently dropped.
      return NextResponse.json(
        { status: "unauthorized", reason: sigResult.reason },
        { status: 401 }
      );
    }
  }

  // --- 2. Parse body ---
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch (error) {
    console.error("[Webhook] Malformed JSON body:", error);
    // Meta won't retry on a 400, which is what we want here.
    return NextResponse.json({ status: "bad_request" }, { status: 400 });
  }

  // --- 3. Normalise + route events ---
  try {
    const events = normalizeWebhookEvents(
      body as Parameters<typeof normalizeWebhookEvents>[0]
    );

    if (events.length === 0) {
      return NextResponse.json({ status: "no_events" });
    }

    console.log(`[Webhook] Processing ${events.length} event(s)`);

    for (const event of events) {
      try {
        if (event.type === "message") {
          await handleMessengerMessage(event);
        } else if (event.type === "comment") {
          await handleComment(event);
        }
      } catch (eventError) {
        // Log but don't fail the whole webhook — Meta will retry otherwise.
        console.error(
          `[Webhook] Error processing ${event.type} event:`,
          eventError
        );
      }
    }

    return NextResponse.json({ status: "ok", processed: events.length });
  } catch (error) {
    console.error("[Webhook] Error routing events:", error);
    // Still return 200 so Meta doesn't storm us with retries.
    return NextResponse.json(
      { status: "error", message: "Routing error" },
      { status: 200 }
    );
  }
}
