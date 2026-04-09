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
  };
}

export default async function Dashboard() {
  const stats = await getStats();

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-full">
        <a href="/auth", className="text-blue-500 hover:text-blue-700">
    toLogin
        </a>
      </div>
    );
  }

  const statsItems = [
    { label: "Total Leads", value: stats.totalLeads, icon: Users },
    { label: "Response Rate", value: `${stats.responseRate}%`, icon: TrendingUp },
    { label: "Active Follow-Ups", value: stats.activeFollowUps, icon: Clock },
    { label: "Booked Leads", value: stats.bookedLeads, icon: CalendarCheck },
  ];

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h1>Dashboard</h1>
        <Link href="/app/leads" className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded">
    toLeads
        </Link>
      </div>
      <div className="flex gap-4">
        {statsItems.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-white p-6 rounded-lg shadow">
              <div className="flex items-center gap-2">
                <Icon className="text-gray-500" />
                <div>
                  <p className="text-sm text-gray-600">{stat.label}</p>
                  <p className="text-2xl font-bold">{stat.value}</p>
                </div>
                <ArrowRight className="text-blue-500" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}