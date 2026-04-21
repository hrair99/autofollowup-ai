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

  const { step } = await req.json();

  // Update the business onboarding step
  await supabase
    .from("businesses")
    .update({ onboarding_step: step })
    .eq("id", businessId);

  // Track in onboarding_sessions table
  // Upsert a single row per business, updating the step arrays and timing
  const now = new Date().toISOString();

  // Check if session exists
  const { data: existing } = await supabase
    .from("onboarding_sessions")
    .select("id, steps_completed, step_timing")
    .eq("business_id", businessId)
    .maybeSingle();

  if (existing) {
    // Update existing session
    const stepsCompleted: string[] = existing.steps_completed || [];
    if (!stepsCompleted.includes(step)) {
      stepsCompleted.push(step);
    }

    const stepTiming: Record<string, unknown> = existing.step_timing || {};
    stepTiming[step] = { ...(stepTiming[step] as Record<string, unknown> || {}), completed_at: now };

    const { error } = await supabase
      .from("onboarding_sessions")
      .update({
        current_step: step,
        steps_completed: stepsCompleted,
        step_timing: stepTiming,
        updated_at: now,
      })
      .eq("id", existing.id);

    if (error) {
      console.warn("[onboarding/step] Failed to update session:", error.message);
    }
  } else {
    // Create new session
    const { error } = await supabase
      .from("onboarding_sessions")
      .insert({
        business_id: businessId,
        user_id: user.id,
        current_step: step,
        steps_completed: [step],
        step_timing: { [step]: { completed_at: now } },
        status: "in_progress",
      });

    if (error) {
      console.warn("[onboarding/step] Failed to create session:", error.message);
    }
  }

  return NextResponse.json({ success: true });
}
