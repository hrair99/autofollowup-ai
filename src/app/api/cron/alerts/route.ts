// ============================================
// Alert System Cron — GET /api/cron/alerts
// Checks for issues across all businesses and logs alerts.
// Designed to run every hour via Vercel Cron.
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface Alert {
  businessId: string;
  businessName: string;
  type: "token_invalid" | "token_expiring" | "no_activity" | "high_failure_rate" | "dead_jobs";
  severity: "warning" | "critical";
  message: string;
  metadata: Record<string, unknown>;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();
  const alerts: Alert[] = [];
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  // Get all active businesses with pages
  const { data: businesses } = await supabase
    .from("businesses")
    .select("id, business_name, name, meta_token_expires_at");

  if (!businesses) {
    return NextResponse.json({ alerts: [], error: "no_businesses" });
  }

  for (const biz of businesses) {
    const bizId = biz.id;
    const bizName = biz.business_name || biz.name || "Unknown";

    // --- 1. Check page token health ---
    const { data: pages } = await supabase
      .from("business_pages")
      .select("page_id, page_name, token_status, is_active")
      .eq("business_id", bizId);

    if (pages) {
      for (const page of pages) {
        if (page.token_status === "invalid" || page.token_status === "expired") {
          alerts.push({
            businessId: bizId,
            businessName: bizName,
            type: "token_invalid",
            severity: "critical",
            message: `Page token for ${page.page_name || page.page_id} is ${page.token_status}. Reconnect the page.`,
            metadata: { pageId: page.page_id, tokenStatus: page.token_status },
          });
        } else if (page.token_status === "expiring") {
          alerts.push({
            businessId: bizId,
            businessName: bizName,
            type: "token_expiring",
            severity: "warning",
            message: `Page token for ${page.page_name || page.page_id} is expiring soon.`,
            metadata: { pageId: page.page_id },
          });
        }
      }
    }

    // --- 2. Check user token expiry ---
    if (biz.meta_token_expires_at) {
      const expiresAt = new Date(biz.meta_token_expires_at);
      const daysUntil = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (daysUntil <= 0) {
        alerts.push({
          businessId: bizId,
          businessName: bizName,
          type: "token_invalid",
          severity: "critical",
          message: `Meta user token has expired. User needs to reconnect Facebook.`,
          metadata: { expiresAt: biz.meta_token_expires_at },
        });
      } else if (daysUntil <= 7) {
        alerts.push({
          businessId: bizId,
          businessName: bizName,
          type: "token_expiring",
          severity: "warning",
          message: `Meta user token expires in ${Math.ceil(daysUntil)} days. Prompt user to reconnect.`,
          metadata: { expiresAt: biz.meta_token_expires_at, daysUntil: Math.ceil(daysUntil) },
        });
      }
    }

    // --- 3. Check for no activity (active pages with no events in 24h) ---
    const activePages = pages?.filter((p) => p.is_active) || [];
    if (activePages.length > 0) {
      const { count: recentActivity } = await supabase
        .from("automation_logs")
        .select("id", { count: "exact", head: true })
        .eq("business_id", bizId)
        .gte("created_at", oneDayAgo);

      if ((recentActivity || 0) === 0) {
        alerts.push({
          businessId: bizId,
          businessName: bizName,
          type: "no_activity",
          severity: "warning",
          message: `No automation activity in the last 24 hours despite ${activePages.length} active page(s).`,
          metadata: { activePages: activePages.length, lastCheck: now.toISOString() },
        });
      }
    }

    // --- 4. Check failure rate (last hour) ---
    const { count: totalActions } = await supabase
      .from("automation_logs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", bizId)
      .gte("created_at", oneHourAgo);

    const { count: failedActions } = await supabase
      .from("automation_logs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", bizId)
      .eq("success", false)
      .gte("created_at", oneHourAgo);

    const total = totalActions || 0;
    const failed = failedActions || 0;
    if (total >= 5 && failed / total > 0.5) {
      alerts.push({
        businessId: bizId,
        businessName: bizName,
        type: "high_failure_rate",
        severity: "critical",
        message: `${failed}/${total} actions failed in the last hour (${Math.round((failed / total) * 100)}% failure rate).`,
        metadata: { total, failed, failureRate: failed / total },
      });
    }

    // --- 5. Check for dead jobs ---
    const { count: deadJobs } = await supabase
      .from("automation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", bizId)
      .eq("status", "dead")
      .gte("updated_at", oneDayAgo);

    if ((deadJobs || 0) > 0) {
      alerts.push({
        businessId: bizId,
        businessName: bizName,
        type: "dead_jobs",
        severity: "warning",
        message: `${deadJobs} job(s) permanently failed (exhausted all retries) in the last 24 hours.`,
        metadata: { deadJobCount: deadJobs },
      });
    }
  }

  // Store alerts for dashboard visibility
  if (alerts.length > 0) {
    // Log critical alerts
    for (const alert of alerts.filter((a) => a.severity === "critical")) {
      await supabase.from("automation_logs").insert({
        business_id: alert.businessId,
        event_type: "system_alert",
        channel: "system",
        action_taken: alert.type,
        details: alert.metadata,
        success: false,
        error_message: alert.message,
      });
    }
  }

  return NextResponse.json({
    checked: businesses.length,
    alertCount: alerts.length,
    critical: alerts.filter((a) => a.severity === "critical").length,
    warnings: alerts.filter((a) => a.severity === "warning").length,
    alerts,
  });
}
