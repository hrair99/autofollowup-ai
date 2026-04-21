import { createServerSupabase } from "@/lib/supabase/server";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import { Users, Building2, Mail, MapPin, Zap, AlertCircle, CheckCircle2, Clock, Phone } from "lucide-react";
import AddLeadButton from "./AddLeadButton";
import LeadFilters from "./LeadFilters";
import type { Lead, UrgencyLevel } from "@/lib/types";
import { getUserBusinessId } from "@/lib/business/resolve";

// Format relative time (e.g., "2 hours ago")
function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return "Never";

  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return date.toLocaleDateString();
}

// Get lead score tier info
function getScoreTierInfo(score: number | null | undefined): { tier: 'hot' | 'warm' | 'cold'; color: string; label: string; bgColor: string } {
  const numScore = score || 0;
  if (numScore >= 65) {
    return { tier: 'hot', color: 'text-green-700', label: 'Hot', bgColor: 'bg-green-100' };
  }
  if (numScore >= 35) {
    return { tier: 'warm', color: 'text-yellow-700', label: 'Warm', bgColor: 'bg-yellow-100' };
  }
  return { tier: 'cold', color: 'text-gray-700', label: 'Cold', bgColor: 'bg-gray-100' };
}

// Get urgency color
function getUrgencyColor(urgency: UrgencyLevel | null | undefined): string {
  switch (urgency) {
    case 'emergency':
      return 'text-red-600 bg-red-50';
    case 'high':
      return 'text-orange-600 bg-orange-50';
    case 'normal':
      return 'text-blue-600 bg-blue-50';
    case 'low':
      return 'text-gray-600 bg-gray-50';
    default:
      return 'text-gray-600 bg-gray-50';
  }
}

// Get source label
function getSourceLabel(source: string): string {
  switch (source?.toLowerCase()) {
    case 'messenger':
      return 'Messenger';
    case 'facebook_comment':
      return 'Comment';
    case 'lead_ad':
      return 'Lead Ad';
    case 'manual':
      return 'Manual';
    case 'email':
      return 'Email';
    default:
      return source || 'Unknown';
  }
}

// Main page component - Server Component
export default async function LeadsPage(props: {
  searchParams?: Promise<{ status?: string; score?: string }>
}) {
  const searchParams = await props.searchParams;
  const statusFilter = searchParams?.status || 'all';
  const scoreTierFilter = searchParams?.score || 'all';

  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Try to get business_id, fall back to user_id
  let businessId: string | null = null;
  try {
    businessId = await getUserBusinessId(user.id);
  } catch (error) {
    console.error("Failed to get business ID:", error);
  }

  // Fetch leads with business scoping
  const { data: leads } = await supabase
    .from("leads")
    .select("*")
    .eq(businessId ? "business_id" : "user_id", businessId || user.id)
    .order("created_at", { ascending: false });

  const leadsData = (leads as Lead[]) || [];

  // Filter leads
  let filtered = leadsData;

  if (statusFilter !== 'all') {
    filtered = filtered.filter(l => l.status === statusFilter);
  }

  if (scoreTierFilter !== 'all') {
    filtered = filtered.filter(l => {
      const score = l.lead_score || 0;
      if (scoreTierFilter === 'hot') return score >= 65;
      if (scoreTierFilter === 'warm') return score >= 35 && score < 65;
      if (scoreTierFilter === 'cold') return score < 35;
      return true;
    });
  }

  // Count stats
  const hotCount = leadsData.filter(l => (l.lead_score || 0) >= 65).length;
  const warmCount = leadsData.filter(l => {
    const score = l.lead_score || 0;
    return score >= 35 && score < 65;
  }).length;
  const coldCount = leadsData.filter(l => (l.lead_score || 0) < 35).length;

  const newCount = leadsData.filter(l => l.status === 'new').length;
  const bookedCount = leadsData.filter(l => l.status === 'booked').length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Leads Inbox</h1>
          <p className="mt-2 text-sm text-gray-600">
            {leadsData.length} total leads
            {newCount > 0 && <span className="ml-4 font-medium text-blue-600">{newCount} new</span>}
            {bookedCount > 0 && <span className="ml-4 font-medium text-green-600">{bookedCount} booked</span>}
          </p>
        </div>
        <AddLeadButton />
      </div>

      {/* Quick stats */}
      {leadsData.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="card p-4">
            <div className="text-2xl font-bold text-green-600">{hotCount}</div>
            <div className="text-xs text-gray-600 mt-1">Hot leads</div>
          </div>
          <div className="card p-4">
            <div className="text-2xl font-bold text-yellow-600">{warmCount}</div>
            <div className="text-xs text-gray-600 mt-1">Warm leads</div>
          </div>
          <div className="card p-4">
            <div className="text-2xl font-bold text-gray-600">{coldCount}</div>
            <div className="text-xs text-gray-600 mt-1">Cold leads</div>
          </div>
        </div>
      )}

      {/* Filters and content */}
      {leadsData.length > 0 ? (
        <div>
          <LeadFilters statusFilter={statusFilter} scoreTierFilter={scoreTierFilter} />

          {/* Leads list */}
          <div className="space-y-3">
            {filtered.map((lead) => {
              const scoreInfo = getScoreTierInfo(lead.lead_score);
              const urgencyClass = getUrgencyColor(lead.urgency_level);
              const location = lead.location_text || lead.qualification_data?.location;
              const serviceType = lead.detected_service_type || lead.qualification_data?.service_type;

              return (
                <Link
                  key={lead.id}
                  href={`/leads/${lead.id}`}
                  className="card p-4 hover:shadow-md transition-all border border-gray-200 hover:border-gray-300 block"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    {/* Left section: Name, contact, location */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col gap-3">
                        {/* Name and contact */}
                        <div>
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {lead.name}
                          </p>
                          <div className="flex flex-col gap-1 mt-1 text-xs text-gray-500">
                            {lead.email && (
                              <div className="flex items-center gap-1 truncate">
                                <Mail className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate">{lead.email}</span>
                              </div>
                            )}
                            {lead.phone && (
                              <div className="flex items-center gap-1 truncate">
                                <Phone className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate">{lead.phone}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Company and location */}
                        <div className="flex flex-wrap gap-2 text-xs">
                          {lead.company && (
                            <div className="flex items-center gap-1 text-gray-600">
                              <Building2 className="h-3 w-3 text-gray-400" />
                              <span className="truncate max-w-xs">{lead.company}</span>
                            </div>
                          )}
                          {location && (
                            <div className="flex items-center gap-1 text-gray-600">
                              <MapPin className="h-3 w-3 text-gray-400" />
                              <span className="truncate">{location}</span>
                            </div>
                          )}
                        </div>

                        {/* Service type */}
                        {serviceType && (
                          <div className="text-xs text-gray-600">
                            <span className="inline-block bg-gray-100 text-gray-700 px-2 py-1 rounded">
                              {serviceType}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Middle section: Status, score, urgency badges */}
                    <div className="flex flex-wrap gap-2 sm:flex-col sm:gap-2 sm:items-end">
                      {/* Status badge */}
                      <div>
                        <StatusBadge status={lead.status} />
                      </div>

                      {/* Lead score */}
                      <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset ${scoreInfo.bgColor} ${scoreInfo.color}`}>
                        <Zap className="h-3 w-3" />
                        {lead.lead_score || 0}
                      </div>

                      {/* Urgency level */}
                      {lead.urgency_level && lead.urgency_level !== 'normal' && (
                        <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset ${urgencyClass}`}>
                          <AlertCircle className="h-3 w-3" />
                          {lead.urgency_level === 'emergency' ? 'Emergency' :
                           lead.urgency_level === 'high' ? 'High' :
                           'Low'}
                        </div>
                      )}

                      {/* Handoff indicator */}
                      {lead.handoff_active && (
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700 ring-1 ring-inset ring-purple-700/10">
                          <AlertCircle className="h-3 w-3" />
                          Handoff
                        </div>
                      )}
                    </div>

                    {/* Right section: Source, booking status, last activity */}
                    <div className="flex flex-col gap-2 sm:items-end text-xs text-gray-600">
                      {/* Source */}
                      <div className="bg-gray-50 px-2.5 py-1 rounded text-gray-700 font-medium">
                        {getSourceLabel(lead.source)}
                      </div>

                      {/* Booking status */}
                      {(lead.enquiry_link_sent_at || lead.enquiry_form_completed) && (
                        <div className="flex items-center gap-1">
                          {lead.enquiry_form_completed ? (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                              <span className="text-green-600 font-medium">Form completed</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" />
                              <span className="text-blue-600 font-medium">Link sent</span>
                            </>
                          )}
                        </div>
                      )}

                      {/* Last activity */}
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-gray-400" />
                        <span>
                          {formatRelativeTime(
                            lead.last_contacted_at ||
                            lead.last_comment_at ||
                            lead.created_at
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Notes preview */}
                  {lead.notes && (
                    <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-600 line-clamp-2">
                      {lead.notes}
                    </div>
                  )}
                </Link>
              );
            })}

            {filtered.length === 0 && (
              <div className="card text-center py-8">
                <Users className="mx-auto h-8 w-8 text-gray-400" />
                <h3 className="mt-2 text-sm font-semibold text-gray-900">No leads found</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {leadsData.length === 0
                    ? "Get started by adding your first lead."
                    : "Try adjusting your filters."}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card text-center py-12">
          <Users className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-semibold text-gray-900">No leads yet</h3>
          <p className="mt-1 text-sm text-gray-500">
            Get started by adding your first lead.
          </p>
        </div>
      )}
    </div>
  );
}
