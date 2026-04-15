import { createServerSupabase } from "@/lib/supabase/server";
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
} from "lucide-react";
import Link from "next/link";
import type { LeadStatus } from "@/lib/types";

async function getStats() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [leadsRes, followUpsRes, recentMessagesRes, recentLogsRes] = await Promise.all([
    supabase.from("leads").select("*").eq("user_id", user.id),
    supabase
      .from("follow_ups")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "pending"),
    supabase
      .from("messages")
      .select("*, leads:lead_id(name, email, company)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("automation_logs")
      .select("*, leads:lead_id(name)")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const allLeads = leadsRes.data || [];
  const totalLeads = allLeads.length;
  const respondedLeads = allLeads.filter((l) => l.status === "responded").length;
  const bookedLeads = allLeads.filter((l) => l.status === "booked").length;
  const activeFollowUps = followUpsRes.data?.length || 0;
  const responseRate =
    totalLeads > 0
      ? Math.round(((respondedLeads + bookedLeads) / totalLeads) * 100)
      : 0;

  const leadsByStatus: Record<string, number> = {};
  allLeads.forEach((l) => {
    leadsByStatus[l.status] = (leadsByStatus[l.status] || 0) + 1;
  });

  // Leads added in last 24h
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const newLast24h = allLeads.filter(
    (l) => new Date(l.created_at).getTime() > oneDayAgo
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
  };
}

async function getSystemHealth() {
  // Server-side fetch to our own diag endpoint, best-effort.
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
    key: "activeFollowUps",
    label: "Active Follow-ups",
    icon: Clock,
    color: "text-purple-600 bg-purple-50",
  },
  {
    key: "respondedLeads",
    label: "Responded",
    icon: MessageSquare,
    color: "text-green-600 bg-green-50",
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
            Overview of your lead follow-up pipeline
          </p>
        </div>
        <Link href="/leads" className="btn-primary">
          <Users className="h-4 w-4 mr-2" />
          View all leads
        </Link>
      </div>

      {/* System Health Banner */}
      {health && <SystemHealthBanner health={health} />}

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
                    +{sub} {card.subLabel}
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

      {/* Recent Activity: Messages + Automation Logs */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Recent Messages</h2>
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
                        {msg.channel || "?"}
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
              No messages yet. Once the webhook is subscribed, messages will appear here
              automatically.
            </p>
          )}
        </div>

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
