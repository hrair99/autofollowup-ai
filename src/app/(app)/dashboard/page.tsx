import { createServerSupabase } from "@/lib/supabase/server";
import {
  Users,
  Clock,
  MessageSquare,
  CalendarCheck,
  TrendingUp,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import type { LeadStatus } from "@/lib/types";

async function getStats() {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: leads } = await supabase
    .from("leads")
    .select("*")
    .eq("user_id", user.id);

  const { data: followUps } = await supabase
    .from("follow_ups")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "pending");

  const { data: recentMessages } = await supabase
    .from("messages")
    .select("*, leads:lead_id(name, email, company)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(5);

  const allLeads = leads || [];
  const totalLeads = allLeads.length;
  const respondedLeads = allLeads.filter((l) => l.status === "responded").length;
  const bookedLeads = allLeads.filter((l) => l.status === "booked").length;
  const activeFollowUps = followUps?.length || 0;
  const responseRate = totalLeads > 0 ? Math.round(((respondedLeads + bookedLeads) / totalLeads) * 100) : 0;

  const leadsByStatus: Record<string, number> = {};
  allLeads.forEach((l) => {
    leadsByStatus[l.status] = (leadsByStatus[l.status] || 0) + 1;
  });

  return {
    totalLeads,
    respondedLeads,
    bookedLeads,
    activeFollowUps,
    responseRate,
    leadsByStatus,
    recentMessages: recentMessages || [],
    recentLeads: allLeads.slice(0, 5),
  };
}

const statCards = [
  { key: "totalLeads", label: "Total Leads", icon: Users, color: "text-blue-600 bg-blue-50" },
  { key: "activeFollowUps", label: "Active Follow-ups", icon: Clock, color: "text-purple-600 bg-purple-50" },
  { key: "respondedLeads", label: "Responded", icon: MessageSquare, color: "text-green-600 bg-green-50" },
  { key: "bookedLeads", label: "Booked", icon: CalendarCheck, color: "text-emerald-600 bg-emerald-50" },
];

export default async function DashboardPage() {
  const stats = await getStats();

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">Overview of your lead follow-up pipeline</p>
        </div>
        <Link href="/leads" className="btn-primary">
          <Users className="h-4 w-4 mr-2" />
          View all leads
        </Link>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {statCards.map((card) => {
          const value = stats ? (stats as any)[card.key] : 0;
          return (
            <div key={card.key} className="card flex items-center gap-4">
              <div className={`rounded-lg p-3 ${card.color}`}>
                <card.icon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">{card.label}</p>
                <p className="text-2xl font-bold text-gray-900">{value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Response Rate + Pipeline */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mb-8">
        {/* Response Rate */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-5 w-5 text-brand-600" />
            <h2 className="text-lg font-semibold text-gray-900">Response Rate</h2>
          </div>
          <div className="flex items-end gap-3">
            <span className="text-5xl font-bold text-gray-900">{stats?.responseRate || 0}%</span>
            <span className="text-sm text-gray-500 mb-2">of leads have responded or booked</span>
          </div>
          <div className="mt-4 h-3 w-full rounded-full bg-gray-100">
            <div
              className="h-3 rounded-full bg-brand-600 transition-all"
              style={{ width: `${stats?.responseRate || 0}%` }}
            />
          </div>
        </div>

        {/* Pipeline */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Pipeline</h2>
          <div className="space-y-3">
            {(['new', 'contacted', 'following_up', 'responded', 'booked', 'dead'] as LeadStatus[]).map(
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
                    <span className="w-8 text-right text-sm font-medium text-gray-900">{count}</span>
                  </div>
                );
              }
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Messages</h2>
          <Link href="/leads" className="text-sm font-medium text-brand-600 hover:text-brand-500 flex items-center gap-1">
            View all <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        {stats?.recentMessages && stats.recentMessages.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {stats.recentMessages.map((msg: any) => (
              <div key={msg.id} className="flex items-center justify-between py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {msg.subject || "No subject"}
                  </p>
                  <p className="text-sm text-gray-500 truncate">
                    To: {msg.leads?.name || "Unknown"} ({msg.leads?.email || ""})
                  </p>
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap ml-4">
                  {new Date(msg.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 py-4 text-center">No messages yet. Add a lead and start following up!</p>
        )}
      </div>
    </div>
  +p;
}
