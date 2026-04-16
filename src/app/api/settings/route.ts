// ============================================
// Settings API — GET/PATCH /api/settings
// Client control panel: toggle automation, tone, areas, cooldowns
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getUserBusinessId } from "@/lib/business/resolve";
import { clearProfileCache } from "@/lib/business/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Allowed fields that can be updated via this endpoint
const ALLOWED_FIELDS = new Set([
  // Automation toggles
  "comment_auto_reply",
  "comment_monitoring_enabled",
  "private_reply_enabled",
  "public_reply_enabled",
  "dm_automation_enabled",
  "auto_follow_up_enabled",
  // Tone & content
  "ai_tone",
  "ai_style_instructions",
  "first_reply_behaviour",
  // Business info
  "business_name",
  "business_description",
  "service_type",
  "service_areas",
  "service_categories",
  "callout_fee",
  "quote_policy",
  "emergency_available",
  "after_hours_available",
  "operating_hours",
  "enquiry_form_url",
  "contact_email",
  "contact_phone",
  "signature",
  // Confidence thresholds
  "comment_confidence_threshold",
  "comment_escalation_threshold",
  "confidence_high_threshold",
  "confidence_safe_threshold",
  // Cooldowns & rate limits
  "comment_cooldown_minutes",
  "comment_user_cooldown_hours",
  "comment_max_actions_per_comment",
  "rate_limit_comments_per_hour",
  "rate_limit_dms_per_hour",
  "rate_limit_public_replies_per_hour",
  // Follow-up config
  "max_follow_ups",
  "follow_up_interval_days",
  "stop_on_reply",
  // Keywords & templates
  "comment_lead_keywords",
  "escalation_keywords",
  "comment_reply_templates",
  "private_reply_templates",
  // ROI
  "estimated_lead_value",
]);

export async function GET() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = await getUserBusinessId(user.id);
  if (!businessId) {
    return NextResponse.json({ error: "No business found" }, { status: 404 });
  }

  // Load settings
  const { data: settings } = await supabase
    .from("settings")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  // Load business info
  const { data: business } = await supabase
    .from("businesses")
    .select("id, business_name, name, mode, plan, industry, subscription_status, onboarding_completed, estimated_lead_value")
    .eq("id", businessId)
    .single();

  // Load usage
  const period = new Date().toISOString().slice(0, 7);
  const { data: usage } = await supabase
    .from("business_usage")
    .select("*")
    .eq("business_id", businessId)
    .eq("period", period)
    .maybeSingle();

  return NextResponse.json({
    settings,
    business,
    usage: usage || {
      comments_processed: 0,
      dms_sent: 0,
      ai_calls: 0,
      public_replies_sent: 0,
      leads_created: 0,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = await getUserBusinessId(user.id);
  if (!businessId) {
    return NextResponse.json({ error: "No business found" }, { status: 404 });
  }

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  // Filter to only allowed fields
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(key)) {
      updates[key] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  // Separate business-level fields from settings-level fields
  const businessFields: Record<string, unknown> = {};
  const settingsFields: Record<string, unknown> = {};
  const BUSINESS_LEVEL_FIELDS = new Set(["estimated_lead_value"]);

  for (const [key, value] of Object.entries(updates)) {
    if (BUSINESS_LEVEL_FIELDS.has(key)) {
      businessFields[key] = value;
    } else {
      settingsFields[key] = value;
    }
  }

  // Update settings table
  if (Object.keys(settingsFields).length > 0) {
    const { error } = await supabase
      .from("settings")
      .update(settingsFields)
      .eq("business_id", businessId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Update business table
  if (Object.keys(businessFields).length > 0) {
    const { error } = await supabase
      .from("businesses")
      .update(businessFields)
      .eq("id", businessId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Clear profile cache after settings change
  clearProfileCache(businessId);

  return NextResponse.json({ success: true, updated: Object.keys(updates) });
}

// Toggle business mode (monitor/active)
export async function PUT(req: NextRequest) {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = await getUserBusinessId(user.id);
  if (!businessId) {
    return NextResponse.json({ error: "No business found" }, { status: 404 });
  }

  const body = await req.json();
  const { mode } = body;

  if (mode !== "monitor" && mode !== "active") {
    return NextResponse.json({ error: "mode must be 'monitor' or 'active'" }, { status: 400 });
  }

  const { error } = await supabase
    .from("businesses")
    .update({ mode, updated_at: new Date().toISOString() })
    .eq("id", businessId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, mode });
}
