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

  await supabase
    .from("businesses")
    .update({
      onboarding_completed: true,
      onboarding_step: "complete",
      updated_at: new Date().toISOString(),
    })
    .eq("id", businessId);

  return NextResponse.json({ success: true });
}
