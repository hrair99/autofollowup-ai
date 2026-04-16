// ============================================
// Stripe Webhook — POST /api/billing/webhook
// Handles Stripe webhook events for subscription lifecycle.
// Verifies webhook signature before processing.
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { handleStripeEvent } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stripe sends raw body — must NOT parse as JSON
export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  let event: any;

  try {
    // Lazy-load Stripe to match the pattern in stripe.ts
    const Stripe = require("stripe");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2024-12-18.acacia",
    });

    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error("[stripe-webhook] Signature verification failed:", err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Process the event
  const relevantEvents = [
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.payment_failed",
  ];

  if (relevantEvents.includes(event.type)) {
    try {
      await handleStripeEvent(event);
      console.log(`[stripe-webhook] Processed ${event.type} for ${event.data.object?.id}`);
    } catch (err: any) {
      console.error(`[stripe-webhook] Error processing ${event.type}:`, err.message);
      // Return 200 anyway — Stripe retries on 5xx and we don't want infinite retries
      // for handler bugs. The event is logged.
    }
  }

  return NextResponse.json({ received: true });
}
