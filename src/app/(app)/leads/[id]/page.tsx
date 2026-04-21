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
  MapPin,
  Zap,
  AlertCircle,
  ShieldAlert,
  CheckCircle2,
  Wrench,
} from "lucide-react";
import LeadActions from "./LeadActions";
import ComposeMessage from "./ComposeMessage";
import type { Lead, Message, FollowUp } from "@/lib/types";
import type { HandoffRecord } from "@/lib/conversation/handoff";
import { getUserBusinessId } from "@/lib/business/resolve";

function getScoreTier(score: number | null) {
  const s = score || 0;
  if (s >= 65) return { label: "Hot", color: "text-green-700", bg: "bg-green-100", ring: "ring-green-600/20" };
  if (s >= 35) return { label: "Warm", color: "text-yellow-700", bg: "bg-yellow-100", ring: "ring-yellow-600/20" };
  return { label: "Cold", color: "text-gray-700", bg: "bg-gray-100", ring: "ring-gray-600/20" };
}

function formatTime(dateString: string | null): string {
  if (!dateString) return "";
  const d = new Date(dateString);
  return d.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function LeadDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const params = await props.params;
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  // Get business ID for multi-tenant scoping
  let businessId: string | null = null;
  try {
    businessId = await getUserBusinessId(user.id);
  } catch { /* fallback to user_id */ }

  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", params.id)
    .single();

  if (!lead) notFound();

  // Verify ownership
  if (businessId) {
    if (lead.business_id !== businessId) notFound();
  } else {
    if (lead.user_id !== user.id) notFound();
  }

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

  // Fetch active handoff if any
  let activeHandoff: HandoffRecord | null = null;
  if (lead.handoff_active) {
    const { data: ho } = await supabase
      .from("conversation_handoffs")
      .select("*")
      .eq("lead_id", params.id)
      .in("status", ["open", "claimed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    activeHandoff = ho as HandoffRecord | null;
  }

  const typedLead = lead as Lead;
  const typedMessages = (messages || []) as Message[];
  const typedFollowUps = (followUps || []) as FollowUp[];
  const scoreTier = getScoreTier(typedLead.lead_score);
  const qualData = typedLead.qualification_data || {};

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

      {/* Handoff banner */}
      {activeHandoff && (
        <div className={`mb-6 rounded-lg border-l-4 p-4 ${
          activeHandoff.status === "claimed"
            ? "border-blue-500 bg-blue-50"
            : activeHandoff.priority === "urgent"
            ? "border-red-500 bg-red-50"
            : "border-yellow-500 bg-yellow-50"
        }`}>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold">
                {activeHandoff.status === "claimed"
                  ? "Handoff claimed — AI replies paused"
                  : "Handoff active — AI replies paused"}
              </p>
              {activeHandoff.trigger_reason && (
                <p className="text-xs text-gray-600 mt-0.5">
                  Reason: {activeHandoff.trigger_reason.replace(/_/g, " ")}
                </p>
              )}
              {activeHandoff.last_customer_message && (
                <p className="text-xs text-gray-500 mt-1 italic line-clamp-2">
                  &ldquo;{activeHandoff.last_customer_message}&rdquo;
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{typedLead.name}</h1>
            <StatusBadge status={typedLead.status} />
            {/* Lead score badge */}
            <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ring-inset ${scoreTier.bg} ${scoreTier.color} ${scoreTier.ring}`}>
              <Zap className="h-3 w-3" />
              {typedLead.lead_score || 0} — {scoreTier.label}
            </div>
            {/* Urgency */}
            {typedLead.urgency_level && typedLead.urgency_level !== "normal" && (
              <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset ${
                typedLead.urgency_level === "emergency"
                  ? "bg-red-100 text-red-700 ring-red-600/20"
                  : typedLead.urgency_level === "high"
                  ? "bg-orange-100 text-orange-700 ring-orange-600/20"
                  : "bg-gray-100 text-gray-700 ring-gray-600/20"
              }`}>
                <AlertCircle className="h-3 w-3" />
                {typedLead.urgency_level === "emergency" ? "Emergency" : typedLead.urgency_level === "high" ? "High Priority" : "Low"}
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-gray-500">
            {typedLead.email && (
              <span className="flex items-center gap-1">
                <Mail className="h-4 w-4" /> {typedLead.email}
              </span>
            )}
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
            {(typedLead.location_text || qualData.location) && (
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" /> {typedLead.location_text || qualData.location}
              </span>
            )}
          </div>
          {typedLead.notes && (
            <p className="mt-2 text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
              {typedLead.notes}
            </p>
          )}
        </div>
        <LeadActions
          lead={typedLead}
          activeHandoff={activeHandoff}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Messages (main area) */}
        <div className="lg:col-span-2 space-y-4">
          <ComposeMessage leadId={typedLead.id} leadName={typedLead.name} />

          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-gray-400" />
              Conversation
              <span className="text-xs font-normal text-gray-400">
                {typedMessages.length} message{typedMessages.length !== 1 ? "s" : ""}
              </span>
            </h2>
            {typedMessages.length > 0 ? (
              <div className="space-y-3">
                {typedMessages.map((msg) => {
                  const isOutbound = msg.direction === "outbound";
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                          isOutbound
                            ? "bg-brand-600 text-white rounded-br-md"
                            : "bg-gray-100 text-gray-900 rounded-bl-md"
                        }`}
                      >
                        {msg.subject && (
                          <p className={`text-xs font-semibold mb-1 ${isOutbound ? "text-brand-100" : "text-gray-500"}`}>
                            {msg.subject}
                          </p>
                        )}
                        <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                        <div className={`flex items-center gap-2 mt-1.5 text-[10px] ${isOutbound ? "text-brand-200" : "text-gray-400"}`}>
                          <span>{formatTime(msg.created_at)}</span>
                          {msg.ai_generated && (
                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full ${isOutbound ? "bg-brand-500/40 text-brand-100" : "bg-purple-100 text-purple-600"}`}>
                              AI
                            </span>
                          )}
                          {msg.channel_type && msg.channel_type !== "email" && (
                            <span className="capitalize">{msg.channel_type}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-6">
                No messages yet. Send the first one above!
              </p>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Qualification data */}
          {Object.keys(qualData).length > 0 && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Wrench className="h-4 w-4 text-gray-400" />
                Qualification Info
              </h2>
              <dl className="space-y-2 text-sm">
                {qualData.location && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Location</dt>
                    <dd className="text-gray-900">{qualData.location}</dd>
                  </div>
                )}
                {qualData.job_type && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Job type</dt>
                    <dd className="text-gray-900 capitalize">{qualData.job_type}</dd>
                  </div>
                )}
                {qualData.service_type && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Service type</dt>
                    <dd className="text-gray-900 capitalize">{qualData.service_type}</dd>
                  </div>
                )}
                {qualData.appliance_type && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">System</dt>
                    <dd className="text-gray-900">{qualData.appliance_type}</dd>
                  </div>
                )}
                {qualData.urgency && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Urgency</dt>
                    <dd className="text-gray-900 capitalize">{qualData.urgency}</dd>
                  </div>
                )}
                {qualData.preferred_timing && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Timing</dt>
                    <dd className="text-gray-900">{qualData.preferred_timing}</dd>
                  </div>
                )}
                {qualData.details && (
                  <div>
                    <dt className="text-gray-500 mb-1">Details</dt>
                    <dd className="text-gray-900 text-xs bg-gray-50 rounded p-2">{qualData.details}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* Booking status */}
          {(typedLead.enquiry_link_sent_at || typedLead.enquiry_form_completed) && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-gray-400" />
                Booking Progress
              </h2>
              <dl className="space-y-2 text-sm">
                {typedLead.enquiry_link_sent_at && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Link sent</dt>
                    <dd className="text-blue-600 font-medium">{formatTime(typedLead.enquiry_link_sent_at)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-gray-500">Form completed</dt>
                  <dd className={typedLead.enquiry_form_completed ? "text-green-600 font-medium" : "text-gray-400"}>
                    {typedLead.enquiry_form_completed ? "Yes" : "No"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Conversion stage</dt>
                  <dd className="text-gray-900 capitalize">{typedLead.conversion_stage.replace(/_/g, " ")}</dd>
                </div>
              </dl>
            </div>
          )}

          {/* Follow-up schedule */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-gray-400" />
              Follow-up Schedule
            </h2>
            {typedFollowUps.length > 0 ? (
              <div className="space-y-2">
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
                      className={`rounded-lg border-l-4 p-3 ${statusColors[fu.status] || "border-gray-300 bg-gray-50"}`}
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
                        {formatTime(fu.scheduled_at)}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-500 text-center py-3">
                No follow-ups scheduled.
              </p>
            )}
          </div>

          {/* Lead details card */}
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
                  <dd className="text-gray-900">{formatTime(typedLead.last_contacted_at)}</dd>
                </div>
              )}
              {typedLead.ai_confidence !== null && typedLead.ai_confidence !== undefined && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">AI confidence</dt>
                  <dd className="text-gray-900">{Math.round(typedLead.ai_confidence * 100)}%</dd>
                </div>
              )}
              {typedLead.detected_service_type && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Service type</dt>
                  <dd className="text-gray-900 capitalize">{typedLead.detected_service_type}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
