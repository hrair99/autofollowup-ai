// ============================================
// Dashboard API — GET /api/dashboard
// Returns business-scoped activity data for the dashboard.
// Authenticated via Supabase session.
// ============================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { getUserBusinessId } from "@/lib/business/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = await getUserBusinessId(user.id);
  const serviceClient = getServiceClient();

  // Build queries scoped to business (or user if no business)
  const scope = businessId
    ? { column: "business_id", value: businessId }
    : { column: "user_id", value: user.id };

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Parallel queries for all dashboard data
  const [
    leadsRes,
    recentCommentsRes,
    recentMessagesRes,
    recentLogsRes,
    failedJobsRes,
    activeFollowUpsRes,
    commentStatsRes,
    connectedPagesRes,
  ] = await Promise.all([
    // All leads for stats
    serviceClient
      .from("leads")
      .select("id, status, conversion_stage, source, created_at")
      .eq(scope.column, scope.value),

    // Recent comments (last 7 days)
    serviceClient
      .from("comments")
      .select(
        "id, comment_id, comment_text, commenter_name, classification, public_reply_text, private_reply_sent_at, created_at, page_id"
      )
      .eq(scope.column, scope.value)
      .order("created_at", { ascending: false })
      .limit(15),

    // Recent messages (last 7 days)
    serviceClient
      .from("messages")
      .select("id, direction, channel, body, subject, created_at, lead_id, leads:lead_id(name)")
      .eq(scope.column, scope.value)
      .order("created_at", { ascending: false })
      .limit(10),

    // Recent automation logs
    serviceClient
      .from("automation_logs")
      .select(
        "id, event_type, channel, action_taken, success, error_message, created_at, lead_id, leads:lead_id(name)"
      )
      .eq(scope.column, scope.value)
      .order("created_at", { ascending: false })
      .limit(15),

    // Failed/dead jobs
    serviceClient
      .from("automation_jobs")
      .select("id, type, status, last_error, attempts, max_attempts, created_at, updated_at")
      .eq(scope.column, scope.value)
      .in("status", ["failed", "dead"])
      .order("updated_at", { ascending: false })
      .limit(10),

    // Active follow-ups count
    serviceClient
      .from("follow_ups")
      .select("id", { count: "exact", head: true })
      .eq(scope.column, scope.value)
      .eq("status", "pending"),

    // Comment stats for last 7 days
    serviceClient
      .from("comments")
      .select("id, classification, public_reply_text, private_reply_sent_at, created_at")
      .eq(scope.column, scope.value)
      .gte("created_at", sevenDaysAgo),

    // Connected pages
    businessId
      ? serviceClient
          .from("business_pages")
          .select("page_id, page_name, is_active, token_status")
          .eq("business_id", businessId)
      : Promise.resolve({ data: [] }),
  ]);

  // Compute stats
  const allLeads = leadsRes.data || [];
  const totalLeads = allLeads.length;
  const respondedLeads = allLeads.filter((l) => l.status === "responded").length;
  const bookedLeads = allLeads.filter((l) => l.status === "booked").length;
  const newLeadsToday = allLeads.filter(
    (l) => l.created_at >= oneDayAgo
  ).length;

  const leadsByStatus: Record<string, number> = {};
  const leadsBySource: Record<string, number> = {};
  allLeads.forEach((l) => {
    leadsByStatus[l.status] = (leadsByStatus[l.status] || 0) + 1;
    const src = l.source || "unknown";
    leadsBySource[src] = (leadsBySource[src] || 0) + 1;
  });

  // Comment stats
  const allComments = commentStatsRes.data || [];
  const totalComments7d = allComments.length;
  const repliedComments = allComments.filter(
    (c) => c.public_reply_text || c.private_reply_sent_at
  ).length;
  const classificationBreakdown: Record<string, number> = {};
  allComments.forEach((c) => {
    const cls = c.classification || "unclassified";
    classificationBreakdown[cls] = (classificationBreakdown[cls] || 0) + 1;
  });

  // Failed actions
  const failedJobs = failedJobsRes.data || [];
  const deadJobs = failedJobs.filter((j) => j.status === "dead").length;
  const retryingJobs = failedJobs.filter((j) => j.status === "failed").length;

  return NextResponse.json({
    stats: {
      totalLeads,
      respondedLeads,
      bookedLeads,
      newLeadsToday,
      activeFollowUps: activeFollowUpsRes.count || 0,
      responseRate:
        totalLeads > 0
          ? Math.round(((respondedLeads + bookedLeads) / totalLeads) * 100)
          : 0,
      leadsByStatus,
      leadsBySource,
    },
    comments: {
      total7d: totalComments7d,
      replied7d: repliedComments,
      replyRate:
        totalComments7d > 0
          ? Math.round((repliedComments / totalComments7d) * 100)
          : 0,
      classificationBreakdown,
      recent: (recentCommentsRes.data || []).slice(0, 10),
    },
    messages: {
      recent: recentMessagesRes.data || [],
    },
    automation: {
      recentLogs: recentLogsRes.data || [],
      failedJobs: failedJobs,
      deadJobCount: deadJobs,
      retryingJobCount: retryingJobs,
    },
    pages: (connectedPagesRes as { data: unknown[] | null }).data || [],
    businessId,
  });
}
