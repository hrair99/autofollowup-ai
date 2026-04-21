import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getUserBusinessId } from "@/lib/business/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const businessId = await getUserBusinessId(user.id);
  if (!businessId) return NextResponse.json({ error: "No business" }, { status: 404 });

  const now = new Date().toISOString();

  // Mark business as onboarded
  await supabase
    .from("businesses")
    .update({
      onboarding_completed: true,
      onboarding_step: "complete",
      updated_at: now,
    })
    .eq("id", businessId);

  // Update onboarding session to completed
  const { data: existing } = await supabase
    .from("onboarding_sessions")
    .select("id, steps_completed, step_timing")
    .eq("business_id", businessId)
    .maybeSingle();

  if (existing) {
    const stepsCompleted: string[] = existing.steps_completed || [];
    if (!stepsCompleted.includes("complete")) {
      stepsCompleted.push("complete");
    }

    const stepTiming: Record<string, unknown> = existing.step_timing || {};
    stepTiming["complete"] = { completed_at: now };

    await supabase
      .from("onboarding_sessions")
      .update({
        status: "completed",
        current_step: "complete",
        steps_completed: stepsCompleted,
        step_timing: stepTiming,
        completed_at: now,
        updated_at: now,
      })
      .eq("id", existing.id);
  } else {
    // Create completed session if none exists
    await supabase
      .from("onboarding_sessions")
      .insert({
        business_id: businessId,
        user_id: user.id,
        current_step: "complete",
        steps_completed: ["complete"],
        step_timing: { complete: { completed_at: now } },
        status: "completed",
        completed_at: now,
      });
  }

  return NextResponse.json({ success: true });
}
