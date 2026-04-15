import { createServerSupabase } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  Clock,
  MessageSquare,
  Calendar,
} from "lucide-react";
import LeadActions from "./LeadActions";
import ComposeMessage from "./ComposeMessage";
import type { Lead, Message, FollowUp } from "@/lib/types";

export default async function LeadDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (!lead) notFound();

  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("lead_id", params.id)
    .order("created_at", { ascending: true });

  const { data: followUps } = await supabase
    .from("follow_ups")
    .select("*")
    .eq("lead_id", params.id)
    .order("step_number", { ascending: true });

  const typedLead = lead as Lead;
  const typedMessages = (messages || []) as Message[];
  const typedFollowUps = (followUps || []) as FollowUp[];

  return (
    <div>
      {/* Back link */}
      <Link
        href="/leads"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to leads
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{typedLead.name}</h1>
            <StatusBadge status={typedLead.status} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <Mail className="h-4 w-4" /> {typedLead.email}
            </span>
            {typedLead.phone && (
              <span className="flex items-center gap-1">
                <Phone className="h-4 w-4" /> {typedLead.phone}
              </span>
            )}
            {typedLead.company && (
              <span className="flex items-center gap-1">
                <Building2 className="h-4 w-4" /> {typedLead.company}
              </span>
            )}
          </div>
          {typedLead.notes && (
            <p className="mt-2 text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
              {typedLead.notes}
            </p>
          )}
        </div>
        <LeadActions lead={typedLead} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Messages (main area) */}
        <div className="lg:col-span-2 space-y-4">
          <ComposeMessage leadId={typedLead.id} leadName={typedLead.name} />

          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-gray-400" />
              Message History
            </h2>
            {typedMessages.length > 0 ? (
              <div className="space-y-4">
                {typedMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`rounded-lg p-4 ${
                      msg.direction === "outbound"
                        ? "bg-brand-50 border border-brand-100"
                        : "bg-gray-50 border border-gray-200"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-gray-500 uppercase">
                        {msg.direction === "outbound" ? "You" : typedLead.name}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(msg.created_at).toLocaleString()}
                      </span>
                    </div>
                    {msg.subject && (
                      <p className="text-sm font-medium text-gray-900 mb-1">
                        {msg.subject}
                      </p>
                    )}
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{msg.body}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-6">
                No messages yet. Send the first one above!
              </p>
            )}
          </div>
        </div>

        {/* Follow-up schedule (sidebar) */}
        <div className="space-y-4">
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Clock className="h-5 w-5 text-gray-400" />
              Follow-up Schedule
            </h2>
            {typedFollowUps.length > 0 ? (
              <div className="space-y-3">
                {typedFollowUps.map((fu) => {
                  const statusColors: Record<string, string> = {
                    pending: "border-yellow-300 bg-yellow-50",
                    sent: "border-green-300 bg-green-50",
                    skipped: "border-gray-300 bg-gray-50",
                    cancelled: "border-red-300 bg-red-50",
                  };
                  return (
                    <div
                      key={fu.id}
                      className={`rounded-lg border-l-4 p-3 ${statusColors[fu.status]}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900">
                          Step {fu.step_number}
                        </span>
                        <span className="text-xs font-medium text-gray-500 capitalize">
                          {fu.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(fu.scheduled_at).toLocaleDateString()}{" "}
                        {new Date(fu.scheduled_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-4">
                No follow-ups scheduled.
              </p>
            )}
          </div>

          {/* Lead info card */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Details</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Source</dt>
                <dd className="text-gray-900 capitalize">{typedLead.source}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Created</dt>
                <dd className="text-gray-900">{new Date(typedLead.created_at).toLocaleDateString()}</dd>
              </div>
              {typedLead.last_contacted_at && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Last contacted</dt>
                  <dd className="text-gray-900">
                    {new Date(typedLead.last_contacted_at).toLocaleDateString()}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
