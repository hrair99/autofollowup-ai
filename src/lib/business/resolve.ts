// ============================================
// Business Resolution — Maps page_id → business context
// Central module for multi-tenant routing
// ============================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface BusinessContext {
  businessId: string;
  businessName: string;
  mode: "monitor" | "active";
  plan: string;
  pageToken: string;      // Page access token for this specific page
  pageId: string;
}

export interface BusinessSettings {
  id: string;
  business_id: string;
  user_id: string;

  // AI & reply config
  ai_tone: string;
  ai_style_instructions: string | null;
  first_reply_behaviour: string;
  business_name: string | null;
  business_description: string | null;
  signature: string | null;
  service_type: string | null;
  service_areas: string[];
  service_categories: string[];
  callout_fee: string | null;
  quote_policy: string | null;
  emergency_available: boolean;
  after_hours_available: boolean;
  operating_hours: string | null;
  enquiry_form_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;

  // Comment automation
  comment_auto_reply: boolean;
  comment_monitoring_enabled: boolean;
  private_reply_enabled: boolean;
  public_reply_enabled: boolean;
  comment_confidence_threshold: number;
  comment_escalation_threshold: number;
  comment_cooldown_minutes: number;
  comment_user_cooldown_hours: number;
  comment_max_actions_per_comment: number;
  comment_reply_templates: string[];
  private_reply_templates: string[];
  comment_lead_keywords: string[];
  dm_automation_enabled: boolean;
  escalation_keywords: string[];

  // Follow-up config
  max_follow_ups: number;
  follow_up_interval_days: number;
  stop_on_reply: boolean;
  auto_follow_up_enabled: boolean;

  // Rate limits
  rate_limit_comments_per_hour: number;
  rate_limit_dms_per_hour: number;
  rate_limit_public_replies_per_hour: number;

  // Meta
  meta_page_id: string | null;
  meta_verify_token: string | null;

  [key: string]: unknown;
}

// Singleton Supabase client for server-side operations
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

// In-memory cache for business lookups (TTL: 5 minutes)
const pageCache = new Map<string, { ctx: BusinessContext; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Resolve a Meta page_id to a full BusinessContext.
 * Used by webhook handlers to determine which business owns a page.
 *
 * Falls back to env-var based token lookup for backwards compatibility
 * during the migration period.
 */
export async function resolveBusinessByPage(
  pageId: string
): Promise<BusinessContext | null> {
  // Check cache first
  const cached = pageCache.get(pageId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.ctx;
  }

  const supabase = getSupabase();

  // Look up in business_pages table
  const { data: bp } = await supabase
    .from("business_pages")
    .select(
      `
      page_id,
      access_token,
      business:businesses!inner (
        id,
        business_name,
        name,
        mode,
        plan
      )
    `
    )
    .eq("page_id", pageId)
    .eq("is_active", true)
    .maybeSingle();

  if (bp?.business) {
    const biz = bp.business as Record<string, unknown>;
    const ctx: BusinessContext = {
      businessId: biz.id as string,
      businessName: (biz.business_name || biz.name) as string,
      mode: (biz.mode || "active") as "monitor" | "active",
      plan: (biz.plan || "free") as string,
      pageToken: bp.access_token,
      pageId,
    };
    pageCache.set(pageId, { ctx, ts: Date.now() });
    return ctx;
  }

  // Fallback: try env-var based tokens (backwards compat during migration)
  const envToken = getEnvPageToken(pageId);
  if (envToken) {
    // Look up which business owns this page via settings.meta_page_id
    const { data: settings } = await supabase
      .from("settings")
      .select("business_id, business_name")
      .eq("meta_page_id", pageId)
      .maybeSingle();

    if (settings?.business_id) {
      const ctx: BusinessContext = {
        businessId: settings.business_id,
        businessName: settings.business_name || "Unknown",
        mode: "active",
        plan: "free",
        pageToken: envToken,
        pageId,
      };
      pageCache.set(pageId, { ctx, ts: Date.now() });
      return ctx;
    }

    // Ultimate fallback: first business in system (single-tenant compat)
    const { data: firstBiz } = await supabase
      .from("businesses")
      .select("id, business_name, name, mode, plan")
      .limit(1)
      .maybeSingle();

    if (firstBiz) {
      const ctx: BusinessContext = {
        businessId: firstBiz.id,
        businessName: firstBiz.business_name || firstBiz.name || "Unknown",
        mode: (firstBiz.mode || "active") as "monitor" | "active",
        plan: (firstBiz.plan || "free") as string,
        pageToken: envToken,
        pageId,
      };
      pageCache.set(pageId, { ctx, ts: Date.now() });
      return ctx;
    }
  }

  return null;
}

/**
 * Load settings for a business.
 */
export async function loadBusinessSettings(
  businessId: string
): Promise<BusinessSettings | null> {
  const supabase = getSupabase();

  const { data } = await supabase
    .from("settings")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  return data as BusinessSettings | null;
}

/**
 * Get the page access token for a specific page.
 * Checks business_pages table first, then falls back to env vars.
 */
export async function getPageTokenForBusiness(
  pageId: string,
  businessId?: string
): Promise<string> {
  const supabase = getSupabase();

  // Try business_pages table first
  if (businessId) {
    const { data } = await supabase
      .from("business_pages")
      .select("access_token")
      .eq("business_id", businessId)
      .eq("page_id", pageId)
      .eq("is_active", true)
      .maybeSingle();

    if (data?.access_token) return data.access_token;
  } else {
    // No businessId — look up by page_id only
    const { data } = await supabase
      .from("business_pages")
      .select("access_token")
      .eq("page_id", pageId)
      .eq("is_active", true)
      .maybeSingle();

    if (data?.access_token) return data.access_token;
  }

  // Fallback to env vars
  const envToken = getEnvPageToken(pageId);
  if (envToken) return envToken;

  throw new Error(
    `No page token found for page ${pageId}` +
      (businessId ? ` (business ${businessId})` : "")
  );
}

/**
 * Get user's active business ID.
 * For now returns the first business the user belongs to.
 * TODO: Support business switching via session/cookie.
 */
export async function getUserBusinessId(
  userId: string
): Promise<string | null> {
  const supabase = getSupabase();

  const { data } = await supabase
    .from("user_businesses")
    .select("business_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  return data?.business_id ?? null;
}

/**
 * Clear the page cache (useful after token refresh).
 */
export function clearPageCache(pageId?: string): void {
  if (pageId) {
    pageCache.delete(pageId);
  } else {
    pageCache.clear();
  }
}

// ============================================
// Env var fallback (backwards compat)
// ============================================

function getEnvPageToken(pageId?: string): string | null {
  if (pageId && process.env.META_PAGE_TOKENS) {
    try {
      const tokens = JSON.parse(process.env.META_PAGE_TOKENS);
      if (tokens[pageId]) return tokens[pageId];
    } catch {
      // Invalid JSON, fall through
    }
  }
  return process.env.META_PAGE_TOKEN || null;
}
