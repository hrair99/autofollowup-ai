// ============================================
// Lead Scoring — Calculates lead quality score
// and ROI estimates based on configurable lead value.
// ============================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ============================================
// Types
// ============================================

export interface LeadScoreBreakdown {
  classification_score: number;    // 0-30 based on classification type
  engagement_score: number;        // 0-25 based on comment count, DM activity
  urgency_score: number;           // 0-20 based on urgency signals
  recency_score: number;           // 0-15 based on how recent the interaction
  intent_score: number;            // 0-10 based on specificity of intent
}

export interface LeadScore {
  total: number;                   // 0-100
  breakdown: LeadScoreBreakdown;
  tier: "hot" | "warm" | "cold";
}

export interface RoiSummary {
  totalLeads: number;
  hotLeads: number;
  warmLeads: number;
  coldLeads: number;
  estimatedLeadValue: number;      // Configurable per business (default $300)
  estimatedTotalRevenue: number;
  estimatedHotRevenue: number;     // Hot leads: 40% close rate
  estimatedWarmRevenue: number;    // Warm leads: 15% close rate
  period: string;                  // YYYY-MM
}

// ============================================
// Scoring Rules
// ============================================

const CLASSIFICATION_SCORES: Record<string, number> = {
  booking_request: 30,
  quote_request: 28,
  pricing_request: 25,
  lead_interest: 20,
  support_request: 15,
  unclear: 5,
  non_lead: 0,
  spam: 0,
  complaint: 0,
};

const URGENCY_SCORES: Record<string, number> = {
  emergency: 20,
  high: 15,
  normal: 8,
  low: 3,
};

/**
 * Calculate a lead score (0-100) from lead data.
 */
export function calculateLeadScore(lead: {
  classification?: string;
  urgency?: string;
  comment_count?: number;
  private_reply_count?: number;
  created_at?: string;
  entities?: Record<string, unknown>;
}): LeadScore {
  const breakdown: LeadScoreBreakdown = {
    classification_score: 0,
    engagement_score: 0,
    urgency_score: 0,
    recency_score: 0,
    intent_score: 0,
  };

  // Classification score (0-30)
  breakdown.classification_score = CLASSIFICATION_SCORES[lead.classification || "unclear"] || 5;

  // Engagement score (0-25)
  const comments = lead.comment_count || 0;
  const dms = lead.private_reply_count || 0;
  breakdown.engagement_score = Math.min(25, comments * 5 + dms * 8);

  // Urgency score (0-20)
  breakdown.urgency_score = URGENCY_SCORES[lead.urgency || "normal"] || 5;

  // Recency score (0-15) — newer = higher score
  if (lead.created_at) {
    const daysSince = (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 1) breakdown.recency_score = 15;
    else if (daysSince < 3) breakdown.recency_score = 12;
    else if (daysSince < 7) breakdown.recency_score = 8;
    else if (daysSince < 14) breakdown.recency_score = 4;
    else breakdown.recency_score = 1;
  }

  // Intent score (0-10) — specificity of what they asked for
  const entities = lead.entities || {};
  let intentPoints = 0;
  if (entities.service_type || entities.issue_type) intentPoints += 4;
  if (entities.location) intentPoints += 3;
  if (entities.property_type) intentPoints += 2;
  if (entities.callback_intent) intentPoints += 1;
  breakdown.intent_score = Math.min(10, intentPoints);

  const total = Math.min(
    100,
    breakdown.classification_score +
    breakdown.engagement_score +
    breakdown.urgency_score +
    breakdown.recency_score +
    breakdown.intent_score
  );

  let tier: "hot" | "warm" | "cold";
  if (total >= 65) tier = "hot";
  else if (total >= 35) tier = "warm";
  else tier = "cold";

  return { total, breakdown, tier };
}

// ============================================
// ROI Estimation
// ============================================

let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

/**
 * Calculate ROI summary for a business.
 */
export async function calculateRoiSummary(
  businessId: string,
  period?: string
): Promise<RoiSummary> {
  const supabase = getSupabase();
  const targetPeriod = period || new Date().toISOString().slice(0, 7);
  const startDate = `${targetPeriod}-01`;
  const endMonth = parseInt(targetPeriod.split("-")[1]);
  const endYear = parseInt(targetPeriod.split("-")[0]);
  const nextMonth = endMonth === 12 ? 1 : endMonth + 1;
  const nextYear = endMonth === 12 ? endYear + 1 : endYear;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;

  // Get business's estimated lead value
  const { data: biz } = await supabase
    .from("businesses")
    .select("estimated_lead_value")
    .eq("id", businessId)
    .single();

  const estimatedLeadValue = biz?.estimated_lead_value || 300;

  // Get all leads for this period
  const { data: leads } = await supabase
    .from("leads")
    .select("id, lead_score, created_at")
    .eq("business_id", businessId)
    .gte("created_at", startDate)
    .lt("created_at", endDate);

  const allLeads = leads || [];
  let hot = 0;
  let warm = 0;
  let cold = 0;

  for (const lead of allLeads) {
    const score = lead.lead_score || 0;
    if (score >= 65) hot++;
    else if (score >= 35) warm++;
    else cold++;
  }

  // ROI estimate: hot leads 40% close rate, warm 15%, cold 3%
  const estimatedHotRevenue = Math.round(hot * estimatedLeadValue * 0.40);
  const estimatedWarmRevenue = Math.round(warm * estimatedLeadValue * 0.15);
  const estimatedColdRevenue = Math.round(cold * estimatedLeadValue * 0.03);
  const estimatedTotalRevenue = estimatedHotRevenue + estimatedWarmRevenue + estimatedColdRevenue;

  return {
    totalLeads: allLeads.length,
    hotLeads: hot,
    warmLeads: warm,
    coldLeads: cold,
    estimatedLeadValue,
    estimatedTotalRevenue,
    estimatedHotRevenue,
    estimatedWarmRevenue,
    period: targetPeriod,
  };
}

/**
 * Score a lead and persist it to the database.
 */
export async function scoreAndPersistLead(
  leadId: string,
  leadData: {
    classification?: string;
    urgency?: string;
    comment_count?: number;
    private_reply_count?: number;
    created_at?: string;
    entities?: Record<string, unknown>;
  }
): Promise<LeadScore> {
  const score = calculateLeadScore(leadData);
  const supabase = getSupabase();

  await supabase
    .from("leads")
    .update({
      lead_score: score.total,
      score_breakdown: score.breakdown,
      needs_manual_review: score.tier === "cold" && (leadData.classification !== "non_lead" && leadData.classification !== "spam"),
    })
    .eq("id", leadId);

  return score;
}
