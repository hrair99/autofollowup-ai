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
  await supabase.from("businesses").update({ onboarding_step: step }).eq("id", businessId);

  return NextResponse.json({ success: true });
}
