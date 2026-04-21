import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getUserBusinessId } from "@/lib/business/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const businessId = await getUserBusinessId(user.id);
  if (!businessId) return NextResponse.json({ error: "No business" }, { status: 404 });

  const { step, metadata } = await req.json();

  // Update the business onboarding step
  await supabase
    .from("businesses")
    .update({ onboarding_step: step })
    .eq("id", businessId);

  // Track in onboarding_sessions table
  // Upsert: one row per business per step
  const sessionData: Record<string, unknown> = {
    business_id: businessId,
    user_id: user.id,
    step_name: step,
    completed_at: new Date().toISOString(),
  };

  if (metadata) {
    sessionData.metadata = metadata;
  }

  const { error: sessionError } = await supabase
    .from("onboarding_sessions")
    .upsert(sessionData, { onConflict: "business_id,step_name" });

  if (sessionError) {
    // Non-critical — log but don't fail the request
    console.warn("[onboarding/step] Failed to track session:", sessionError.message);
  }

  return NextResponse.json({ success: true });
}
