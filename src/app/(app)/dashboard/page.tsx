import { createServerSupabase } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { getUserBusinessId } from "@/lib/business/resolve";
import {
  Users,
  Clock,
  MessageSquare,
  CalendarCheck,
  TrendingUp,
  ArrowRight,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MessageCircle,
  Zap,
  Link2,
} from "lucide-react";
import Link from "next/link";
import type { LeadStatus } from "@/lib/types";
import { AutomationToggle, RoiDisplay, AlertsPanel, HandoffsPanel } from "./DashboardWidgets";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getStats() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const businessId = await getUserBusinessId(user.id);
  const serviceClient = getServiceClient();

  // Scope queries to business or user
  // Fetch business settings for automation toggle
  let businessMode = "monitor";
  let onboardingCompleted = false;
  if (businessId) {
    const { data: biz } = await serviceClient
      .from("businesses")
      .select("mode, onboarding_completed")
      .eq("id", businessId)
      .single();
    if (biz) {
      businessMode = biz.mode || "monitor";
      onboardingCompleted = !!biz.onboarding_completed;
    }
  }

  const scope = businessId
    ? { column: "business_id" as const, value: businessId }
    : { column: "user_id" as const, value: user.id };

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    leadsRes,
    followUpsRes,
    recentMessagesRes,
    recentLogsRes,
    recentCommentsRes,
    failedJobsRes,
    commentStats7dRes,
    connectedPagesRes,
  ] = await Promise.all([
    serviceClient.from("leads").select("*").eq(scope.column, scope.value),
    serviceClient
      .from("follow_ups")
      .select("id", { count: "exact", head: true })
      .eq(scope.column, scope.value)
      .eq("status", "pending"),
    serviceClient
      .from("messages")
      .select("*, leads:lead_id(name, email, company)")
      .eq(scope.column, scope.value)
      .order("created_at", { ascending: false })
      .limit(6),
    serviceClient
      .from("automation_logs")
      .select("*, leads:lead_id(name)")
      .eq(scope.column, scope.value)
      .order("created_at", { ascending: false })
      .limit(8),
    serviceClient
      .from("comments")
      .select(
        "id, comment_text, commenter_name, classification, public_reply_text, private_reply_sent_at, created_at"
      )
      .eq(scope.column, scope.value)
      .order("created_at", { ascending: false })
      .limit(8),
    serviceClient
      .from("automation_jobs")
      .select("id, type, status, last_error, attempts, max_attempts, created_at, updated_at")
      .eq(scope.column, scope.value)
      .in("status", ["failed", "dead"])
      .order("updated_at", { ascending: false })
      .limit(5),
    serviceClient
      .from("comments")
      .select("id, classification, public_reply_text, private_reply_sent_at")
      .eq(scope.column, scope.value)
      .gte("created_at", sevenDaysAgo),
    businessId
      ? serviceClient
          .from("business_pages")
          .select("page_id, page_name, is_active, token_status")
          .eq("business_id", businessId)
      : Promise.resolve({ data: [] as { page_id: string; page_name: string; is_active: boolean; token_status: string }[] }),
  ]);

  const allLeads = leadsRes.data || [];
  const totalLeads = allLeads.length;
  const respondedLeads = allLeads.filter((l) => l.status === "responded").length;
  const bookedLeads = allLeads.filter((l) => l.status === "booked").length;
  const activeFollowUps = followUpsRes.count || 0;
  const responseRate =
    totalLeads > 0
      ? Math.round(((respondedLeads + bookedLeads) / totalLeads) * 100)
      : 0;

  const leadsByStatus: Record<string, number> = {};
  allLeads.forEach((l) => {
    leadsByStatus[l.status] = (leadsByStatus[l.status] || 0) + 1;
  });

  const newLast24h = allLeads.filter(
    (l) => l.created_at >= oneDayAgo
  ).length;

  // Comment stats
  const allComments7d = commentStats7dRes.data || [];
  const totalComments7d = allComments7d.length;
  const repliedComments7d = allComments7d.filter(
    (c) => c.public_reply_text || c.private_reply_sent_at
  ).length;

  return {
    totalLeads,
    respondedLeads,
    bookedLeads,
    activeFollowUps,
    responseRate,
    leadsByStatus,
    newLast24h,
    recentMessages: recentMessagesRes.data || [],
    recentLogs: recentLogsRes.data || [],
    recentComments: recentCommentsRes.data || [],
    failedJobs: failedJobsRes.data || [],
    totalComments7d,
    repliedComments7d,
    commentReplyRate:
      totalComments7d > 0
        ? Math.round((repliedComments7d / totalComments7d) * 100)
        : 0,
    connectedPages: connectedPagesRes.data || [],
    businessId,
    businessMode,
    onboardingCompleted,
  };
}

async function getSystemHealth() {
  try {
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";
    const res = await fetch(`${base}/api/diag`, {
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET || ""}`,
      },
      cache: "no-store",
    });
    if (!res.ok && res.status !== 503) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const statCards = [
  {
    key: "totalLeads",
    label: "Total Leads",
    icon: Users,
    color: "text-blue-600 bg-blue-50",
    subKey: "newLast24h",
    subLabel: "new today",
  },
  {
    key: "totalComments7d",
    label: "Comments (7d)",
    icon: MessageCircle,
    color: "text-orange-600 bg-orange-50",
    subKey: "commentReplyRate",
    subLabel: "% reply rate",
  },
  {
    key: "activeFollowUps",
    label: "Active Follow-ups",
    icon: Clock,
    color: "text-purple-600 bg-purple-50",
  },
  {
    key: "bookedLeads",
    label: "Booked",
    icon: CalendarCheck,
    color: "text-emerald-600 bg-emerald-50",
  },
];

export default async function DashboardPage() {
  const [stats, health] = await Promise.all([getStats(), getSystemHealth()]);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Overview of your lead follow-up pipeline and automation activity
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/connect"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Link2 className="h-4 w-4" />
            Pages
          </Link>
          <Link href="/leads" className="btn-primary">
            <Users className="h-4 w-4 mr-2" />
            View all leads
          </Link>
        </div>
      </div>

      {/* System Health Banner */}
      {health && <SystemHealthBanner health={health} />}

      {/* Automation Toggle + ROI + Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <AutomationToggle
          initialMode={stats?.businessMode || "monitor"}
          hasConnectedPage={(stats?.connectedPages?.length || 0) > 0}
          onboardingCompleted={stats?.onboardingCompleted || false}
        />
        <RoiDisplay />
        <AlertsPanel />
      </div>

      {/* Handoffs Panel */}
      <div className="mb-6">
        <HandoffsPanel />
      </div>

      {/* Connected Pages Status */}
      {stats?.connectedPages && stats.connectedPages.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {(stats.connectedPages as any[]).map((page: any) => (
            <div
              key={page.page_id}
              className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs"
            >
              <div
                className={`h-2 w-2 rounded-full ${
                  page.is_active && page.token_status === "valid"
                    ? "bg-green-500"
                    : page.token_status === "invalid" || page.token_status === "expired"
                      ? "bg-red-500"
                      : "bg-yellow-500"
                }`}
              />
              <span className="font-medium text-gray-700">
                {page.page_name || page.page_id}
              </span>
              <span className="text-gray-400">
                {page.is_active ? "Active" : "Paused"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {statCards.map((card) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const value = stats ? (stats as any)[card.key] : 0;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sub = card.subKey && stats ? (stats as any)[card.subKey] : null;
          return (
            <div key={card.key} className="card flex items-center gap-4">
              <div className={`rounded-lg p-3 ${card.color}`}>
                <card.icon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">{card.label}</p>
                <p className="text-2xl font-bold text-gray-900">{value}</p>
                {sub !== null && sub > 0 && (
                  <p className="text-xs text-emerald-600 font-medium">
                    {card.subLabel?.includes("%") ? `${sub}${card.subLabel}` : `+${sub} ${card.subLabel}`}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Response Rate + Pipeline */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mb-8">
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-5 w-5 text-brand-600" />
            <h2 className="text-lg font-semibold text-gray-900">Response Rate</h2>
          </div>
          <div className="flex items-end gap-3">
            <span className="text-5xl font-bold text-gray-900">
              {stats?.responseRate || 0}%
            </span>
            <span className="text-sm text-gray-500 mb-2">
              of leads have responded or booked
            </span>
          </div>
          <div className="mt-4 h-3 w-full rounded-full bg-gray-100">
            <div
              className="h-3 rounded-full bg-brand-600 transition-all"
              style={{ width: `${stats?.responseRate || 0}%` }}
            />
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Pipeline</h2>
          <div className="space-y-3">
            {(["new", "contacted", "following_up", "responded", "booked", "dead"] as LeadStatus[]).map(
              (status) => {
                const count = stats?.leadsByStatus[status] || 0;
                const total = stats?.totalLeads || 1;
                const pct = Math.round((count / total) * 100);
                const colors: Record<string, string> = {
                  new: "bg-blue-500",
                  contacted: "bg-yellow-500",
                  following_up: "bg-purple-500",
                  responded: "bg-green-500",
                  booked: "bg-emerald-500",
                  dead: "bg-gray-400",
                };
                const labels: Record<string, string> = {
                  new: "New",
                  contacted: "Contacted",
                  following_up: "Following Up",
                  responded: "Responded",
                  booked: "Booked",
                  dead: "Dead",
                };
                return (
                  <div key={status} className="flex items-center gap-3">
                    <span className="w-24 text-sm text-gray-600">{labels[status]}</span>
                    <div className="flex-1 h-2 rounded-full bg-gray-100">
                      <div
                        className={`h-2 rounded-full ${colors[status]} transition-all`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-sm font-medium text-gray-900">
                      {count}
                    </span>
                  </div>
                );
              }
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity: Comments + Messages */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mb-8">
        {/* Recent Comments */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-orange-600" />
              <h2 className="text-lg font-semibold text-gray-900">Recent Comments</h2>
            </div>
            <span className="text-xs text-gray-400">
              {stats?.totalComments7d || 0} this week
            </span>
          </div>
          {stats?.recentComments && stats.recentComments.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {stats.recentComments.map((comment: any) => (
                <div key={comment.id} className="py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-900">
                      {comment.commenter_name || "Unknown"}
                    </span>
                    {comment.classification && (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          comment.classification === "lead"
                            ? "bg-blue-50 text-blue-700"
                            : comment.classification === "complaint"
                              ? "bg-red-50 text-red-700"
                              : comment.classification === "question"
                                ? "bg-yellow-50 text-yellow-700"
                                : "bg-gray-50 text-gray-600"
                        }`}
                      >
                        {comment.classification}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-gray-400">
                      {new Date(comment.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 truncate">
                    {comment.comment_text || "(empty)"}
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    {comment.public_reply_text && (
                      <span className="text-xs text-green-600">
                        ✓ Public reply sent
                      </span>
                    )}
                    {comment.private_reply_sent_at && (
                      <span className="text-xs text-blue-600">
                        ✓ DM sent
                      </span>
                    )}
                    {!comment.public_reply_text && !comment.private_reply_sent_at && (
                      <span className="text-xs text-gray-400">
                        No reply yet
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-4 text-center">
              No comments tracked yet. Connect a page and enable comment monitoring.
            </p>
          )}
        </div>

        {/* Recent Messages */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900">Recent DMs</h2>
            </div>
            <Link
              href="/leads"
              className="text-sm font-medium text-brand-600 hover:text-brand-500 flex items-center gap-1"
            >
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          {stats?.recentMessages && stats.recentMessages.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {stats.recentMessages.map((msg: any) => (
                <div
                  key={msg.id}
                  className="flex items-start justify-between py-3 gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          msg.direction === "inbound"
                            ? "bg-blue-50 text-blue-700"
                            : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {msg.direction}
                      </span>
                      <span className="text-xs text-gray-500">
                        {msg.channel || "messenger"}
                      </span>
                    </div>
                    <p className="text-sm text-gray-900 truncate">
                      {msg.body || msg.subject || "(no content)"}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {msg.leads?.name || "Unknown lead"}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
                    {new Date(msg.created_at).toLocaleString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-4 text-center">
              No messages yet. Once the webhook is active, DMs will appear here.
            </p>
          )}
        </div>
      </div>

      {/* Automation Feed + Failed Actions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-5 w-5 text-brand-600" />
            <h2 className="text-lg font-semibold text-gray-900">Automation Feed</h2>
          </div>
          {stats?.recentLogs && stats.recentLogs.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {stats.recentLogs.map((log: any) => (
                <div key={log.id} className="py-3">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        log.success
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-red-50 text-red-700"
                      }`}
                    >
                      {log.event_type}
                    </span>
                    <span className="text-xs text-gray-500">{log.channel}</span>
                    <span className="ml-auto text-xs text-gray-400">
                      {new Date(log.created_at).toLocaleString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="text-sm text-gray-800">
                    {log.action_taken}
                    {log.leads?.name ? ` — ${log.leads.name}` : ""}
                  </p>
                  {log.error_message && (
                    <p className="text-xs text-red-600 mt-0.5 truncate">
                      {log.error_message}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-4 text-center">
              No automation events yet. Send a DM to the page to trigger the bot.
            </p>
          )}
        </div>

        {/* Failed Actions */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-5 w-5 text-red-600" />
            <h2 className="text-lg font-semibold text-gray-900">Failed Actions</h2>
            {stats?.failedJobs && stats.failedJobs.length > 0 && (
              <span className="ml-auto inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
                {stats.failedJobs.length} issue{stats.failedJobs.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
          {stats?.failedJobs && stats.failedJobs.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {stats.failedJobs.map((job: any) => (
                <div key={job.id} className="py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        job.status === "dead"
                          ? "bg-red-100 text-red-800"
                          : "bg-yellow-100 text-yellow-800"
                      }`}
                    >
                      {job.status === "dead" ? "DEAD" : `Retry ${job.attempts}/${job.max_attempts}`}
                    </span>
                    <span className="text-xs font-medium text-gray-700">
                      {job.type.replace("handle_", "")}
                    </span>
                    <span className="ml-auto text-xs text-gray-400">
                      {new Date(job.updated_at || job.created_at).toLocaleString(
                        undefined,
                        { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
                      )}
                    </span>
                  </div>
                  {job.last_error && (
                    <p className="text-xs text-red-600 truncate">
                      {job.last_error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 py-4 justify-center">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <p className="text-sm text-gray-500">No failed actions. All good!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SystemHealthBanner({ health }: { health: any }) {
  const status = health?.overall || "unknown";
  const checks = health?.checks || {};

  if (status === "healthy") {
    return (
      <div className="card bg-emerald-50 border-emerald-200 flex items-center gap-3 mb-6">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
        <div className="text-sm">
          <span className="font-semibold text-emerald-900">All systems operational</span>
          <span className="text-emerald-700 ml-2">
            Webhook, Groq AI, Meta API, and Supabase are all healthy.
          </span>
        </div>
      </div>
    );
  }

  const fails: string[] = [];
  if (checks.groq && !checks.groq.ok) fails.push("Groq AI");
  if (checks.meta_token && !checks.meta_token.ok) fails.push("Meta page token");
  if (checks.supabase && !checks.supabase.ok) fails.push("Supabase");
  if (checks.users && !checks.users.ok) fails.push("No users — sign up first");

  const isDegraded = status === "degraded";

  return (
    <div
      className={`card flex items-start gap-3 mb-6 ${
        isDegraded ? "bg-red-50 border-red-200" : "bg-yellow-50 border-yellow-200"
      }`}
    >
      {isDegraded ? (
        <XCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
      ) : (
        <AlertTriangle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
      )}
      <div className="text-sm flex-1">
        <span
          className={`font-semibold ${
            isDegraded ? "text-red-900" : "text-yellow-900"
          }`}
        >
          System {status}
        </span>
        <span
          className={`ml-2 ${isDegraded ? "text-red-700" : "text-yellow-700"}`}
        >
          Attention needed: {fails.join(", ") || "see /api/diag for details"}.
        </span>
      </div>
    </div>
  );
}
