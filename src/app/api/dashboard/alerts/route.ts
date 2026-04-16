// ============================================
// Alerts API — GET/PATCH /api/dashboard/alerts
// Surfaces business alerts for the dashboard.
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getUserBusinessId } from "@/lib/business/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = await getUserBusinessId(user.id);
  if (!businessId) {
    return NextResponse.json({ error: "No business found" }, { status: 404 });
  }

  // Get unacknowledged alerts, most recent first
  const { data: alerts } = await supabase
    .from("business_alerts")
    .select("*")
    .eq("business_id", businessId)
    .eq("acknowledged", false)
    .order("created_at", { ascending: false })
    .limit(20);

  // Count by severity
  const critical = (alerts || []).filter((a) => a.severity === "critical").length;
  const warnings = (alerts || []).filter((a) => a.severity === "warning").length;

  return NextResponse.json({
    alerts: alerts || [],
    summary: {
      total: (alerts || []).length,
      critical,
      warnings,
    },
  });
}

// Acknowledge an alert
export async function PATCH(req: NextRequest) {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = await getUserBusinessId(user.id);
  if (!businessId) {
    return NextResponse.json({ error: "No business found" }, { status: 404 });
  }

  const body = await req.json();
  const { alertId, acknowledgeAll } = body;

  if (acknowledgeAll) {
    await supabase
      .from("business_alerts")
      .update({
        acknowledged: true,
        acknowledged_at: new Date().toISOString(),
      })
      .eq("business_id", businessId)
      .eq("acknowledged", false);

    return NextResponse.json({ success: true, action: "acknowledged_all" });
  }

  if (!alertId) {
    return NextResponse.json({ error: "alertId required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("business_alerts")
    .update({
      acknowledged: true,
      acknowledged_at: new Date().toISOString(),
    })
    .eq("id", alertId)
    .eq("business_id", businessId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
