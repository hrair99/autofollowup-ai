// ============================================
// Billing Checkout — POST /api/billing/checkout
// Creates a Stripe Checkout Session for plan upgrade.
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createCheckoutSession, STRIPE_PRICES } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { plan } = body;

  if (!plan || !STRIPE_PRICES[plan]) {
    return NextResponse.json(
      { error: "Invalid plan. Must be one of: starter, pro, unlimited" },
      { status: 400 }
    );
  }

  // Get user's business
  const { data: ub } = await supabase
    .from("user_businesses")
    .select("business_id")
    .eq("user_id", user.id)
    .single();

  if (!ub) {
    return NextResponse.json({ error: "No business found" }, { status: 404 });
  }

  const origin = req.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const successUrl = `${origin}/settings?billing=success&plan=${plan}`;
  const cancelUrl = `${origin}/settings?billing=canceled`;

  const result = await createCheckoutSession(ub.business_id, plan, successUrl, cancelUrl);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ url: result.url });
}
