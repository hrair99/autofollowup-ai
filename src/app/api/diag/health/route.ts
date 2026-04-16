// ============================================
// Extended health probe — /api/diag/health
//
// Surfaces operational telemetry beyond the basic /api/diag:
//   - last webhook delivery timestamp (by status)
//   - last successful private reply
//   - last failed private reply
//   - pending / failed / dead job counts
//   - token check age
//
// Raises warnings when no feed/comment webhook has been observed recently.
// ============================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FEED_STALE_HOURS = Number(process.env.FEED_STALE_WARN_HOURS || 6);

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const supabase = db();
  const warnings: string[] = [];

  // --- Webhook delivery freshness ---
  const { data: lastDelivery } = await supabase
    .from("webhook_deliveries")
    .select("created_at, status, event_types")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const { data: recentDeliveries } = await supabase
    .from("webhook_deliveries")
    .select("created_at, event_types, status")
    .gte(
      "created_at",
      new Date(Date.now() - FEED_STALE_HOURS * 3600_000).toISOString()
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const commentDeliveries = (recentDeliveries || []).filter((r) => {
    const et = Array.isArray(r.event_types) ? r.event_types : [];
    return et.includes("comment");
  });

  if (commentDeliveries.length === 0) {
    warnings.push(
      `No feed/comment webhook deliveries observed in last ${FEED_STALE_HOURS}h. ` +
        `Likely causes: app missing Pages 'feed' subscription, page unsubscribed, ` +
        `or Meta dropping deliveries (check App Dashboard > Webhooks > Recent Deliveries).`
    );
  }

  // --- Last private reply attempts (success / failure) ---
  const { data: lastPrivateOk } = await supabase
    .from("comments")
    .select("private_reply_sent_at")
    .not("private_reply_sent_at", "is", null)
    .order("private_reply_sent_at", { ascending: false })
    .limit(1)
    .single();

  const { data: lastPrivateFail } = await supabase
    .from("automation_logs")
    .select("created_at, details")
    .eq("channel", "facebook_comment")
    .eq("success", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // --- Job queue counts ---
  const [pending, failed, dead, running] = await Promise.all([
    supabase
      .from("automation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("automation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    supabase
      .from("automation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "dead"),
    supabase
      .from("automation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "running"),
  ]);

  if ((dead.count || 0) > 0) {
    warnings.push(`${dead.count} job(s) in 'dead' state — investigate last_error.`);
  }

  // --- Meta token live check ---
  const tokenCheck = await checkToken();

  return NextResponse.json({
    now: new Date().toISOString(),
    warnings,
    webhook: {
      last_delivery_at: lastDelivery?.created_at || null,
      last_delivery_status: lastDelivery?.status || null,
      comment_deliveries_recent: commentDeliveries.length,
      stale_threshold_hours: FEED_STALE_HOURS,
    },
    private_reply: {
      last_success_at: lastPrivateOk?.private_reply_sent_at || null,
      last_failure_at: lastPrivateFail?.created_at || null,
      last_failure_details: lastPrivateFail?.details || null,
    },
    jobs: {
      pending: pending.count || 0,
      running: running.count || 0,
      failed: failed.count || 0,
      dead: dead.count || 0,
    },
    meta_token: tokenCheck,
    env_present: {
      META_SKIP_SIGNATURE_CHECK: process.env.META_SKIP_SIGNATURE_CHECK || null,
      WEBHOOK_INLINE_COMMENTS: process.env.WEBHOOK_INLINE_COMMENTS || null,
    },
  });
}

async function checkToken(): Promise<{ ok: boolean; detail?: string }> {
  const token = process.env.META_PAGE_TOKEN;
  if (!token) return { ok: false, detail: "no_token" };
  try {
    const res = await fetch(
      `https://graph.facebook.com/v25.0/me?access_token=${token}`
    );
    if (!res.ok) return { ok: false, detail: `http_${res.status}` };
    const j = (await res.json()) as { id?: string; name?: s