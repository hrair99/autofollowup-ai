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

  // Mark business as onboarded
  await supabase
    .from("businesses")
    .update({
      onboarding_completed: true,
      onboarding_step: "complete",
      updated_at: new Date().toISOString(),
    })
    .eq("id", businessId);

  // Track completion in onboarding_sessions
  const { error: sessionError } = await supabase
    .from("onboarding_sessions")
    .upsert(
      {
        business_id: businessId,
        user_id: user.id,
        step_name: "complete",
        completed_at: new Date().toISOString(),
        metadata: { completed_by: user.id },
      },
      { onConflict: "business_id,step_name" }
    );

  if (sessionError) {
    console.warn("[onboarding/complete] Failed to track session:", sessionError.message);
  }

  return NextResponse.json({ success: true });
}
