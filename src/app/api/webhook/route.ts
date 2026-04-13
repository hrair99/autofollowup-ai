import { NextRequest, NextResponse } from "next/server";
import { normalizeWebhookEvents, verifyWebhook } from "@/lib/meta/webhooks";
import { handleMessengerMessage } from "@/lib/conversation/engine";
import { handleComment } from "@/lib/conversation/commentHandler";

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "autofollowup_verify_token_2024";

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
    console.log("Webhook verified successfully");
    return new NextResponse(result.challenge);
  }

  return new NextResponse("Verification failed", { status: 403 });
}

// ============================================
// POST — Incoming events from Meta (messages + comments)
// ============================================
export async function POST(req: NextRequest) {
  // Always return 200 immediately to prevent Meta retries
  // Process events asynchronously
  try {
    const body = await req.json();

    // Normalize all events from the raw webhook payload
    const events = normalizeWebhookEvents(body);

    if (events.length === 0) {
      return NextResponse.json({ status: "no_events" });
    }

    console.log(`[Webhook] Processing ${events.length} event(s)`);

    // Process events — don't await to keep response fast
    // But since Vercel serverless needs us to finish before returning,
    // we process sequentially but return 200 regardless of errors
    for (const event of events) {
      try {
        if (event.type === "message") {
          await handleMessengerMessage(event);
        } else if (event.type === "comment") {
          await handleComment(event);
        }
      } catch (eventError) {
        // Log but don't fail the whole webhook
        console.error(`[Webhook] Error processing ${event.type} event:`, eventError);
      }
    }

    return NextResponse.json({ status: "ok", processed: events.length });
  } catch (error) {
    console.error("[Webhook] Error parsing payload:", error);
    // STILL return 200 to prevent Meta from retrying
    return NextResponse.json({ status: "error", message: "Parse error" }, { status: 200 });
  }
}
