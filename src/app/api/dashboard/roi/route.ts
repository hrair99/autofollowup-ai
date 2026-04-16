// ============================================
// ROI Dashboard — GET /api/dashboard/roi
// Returns lead scoring summary and revenue estimates.
// ============================================

import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getUserBusinessId } from "@/lib/business/resolve";
import { calculateRoiSummary } from "@/lib/leads/scoring";

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

  const now = new Date();
  const currentPeriod = now.toISOString().slice(0, 7);

  // Calculate current month and previous month for comparison
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevPeriod = prevMonth.toISOString().slice(0, 7);

  const [current, previous] = await Promise.all([
    calculateRoiSummary(businessId, currentPeriod),
    calculateRoiSummary(businessId, prevPeriod),
  ]);

  return NextResponse.json({
    current,
    previous,
    monthOverMonth: {
      leadGrowth: previous.totalLeads > 0
        ? Math.round(((current.totalLeads - previous.totalLeads) / previous.totalLeads) * 100)
        : null,
      revenueGrowth: previous.estimatedTotalRevenue > 0
        ? Math.round(((current.estimatedTotalRevenue - previous.estimatedTotalRevenue) / previous.estimatedTotalRevenue) * 100)
        : null,
    },
  });
}
