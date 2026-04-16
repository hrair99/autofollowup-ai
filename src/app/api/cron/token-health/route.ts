// ============================================
// Token Health Cron — GET /api/cron/token-health
// Checks all active page tokens and updates their status.
// Call from Vercel Cron or manually with ?secret=
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { checkAllTokenHealth, refreshPageToken } from "@/lib/meta/tokenHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header =
    req.headers.get("authorization") ||
    req.headers.get("x-cron-secret") ||
    "";
  const query = new URL(req.url).searchParams.get("secret") || "";
  return (
    header === secret ||
    header === `Bearer ${secret}` ||
    query === secret
  );
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const results = await checkAllTokenHealth();

  // Auto-refresh tokens that are expiring
  const refreshResults: Array<{
    pageId: string;
    refreshed: boolean;
    error?: string;
  }> = [];

  for (const r of results) {
    if (r.status === "expiring") {
      const refresh = await refreshPageToken(r.businessId, r.pageId);
      refreshResults.push({
        pageId: r.pageId,
        refreshed: refresh.ok,
        error: refresh.error,
      });
    }
  }

  return NextResponse.json({
    checked: results.length,
    results,
    refreshed: refreshResults,
    summary: {
      valid: results.filter((r) => r.status === "valid").length,
      expiring: results.filter((r) => r.status === "expiring").length,
      expired: results.filter((r) => r.status === "expired").length,
      invalid: results.filter((r) => r.status === "invalid").length,
    },
  });
}
