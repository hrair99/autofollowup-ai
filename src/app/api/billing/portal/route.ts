// ============================================
// Billing Portal — POST /api/billing/portal
// Creates a Stripe Billing Portal session for managing subscription.
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createPortalSession } from "@/lib/billing/stripe";

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
  const returnUrl = `${origin}/settings`;

  const result = await createPortalSession(ub.business_id, returnUrl);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ url: result.url });
}
