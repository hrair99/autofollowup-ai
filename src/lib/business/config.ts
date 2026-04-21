// ============================================
// Business Config System — Typed, cached, multi-tenant
//
// Reads from business_configs table (key/value pairs per business)
// with fallback to the legacy settings table during migration.
// In-memory cache with 5-minute TTL.
//
// Usage:
//   const cfg = await getBusinessConfig(businessId);
//   cfg.ai.tone           // "friendly"
//   cfg.service.areas     // ["Maitland", "Newcastle"]
//   cfg.comment.automation.private_reply_enabled // true
// ============================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;

let _supabase: DB | null = null;
function db(): DB {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

// ============================================
// Config shape (fully typed)
// ============================================

export interface BusinessInfo {
  name: string | null;
  description: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  enquiry_form_url: string | null;
  service_type: string | null;
  callout_fee: string | null;
  quote_policy: string | null;
  emergency_available: boolean;
  after_hours_available: boolean;
  operating_hours: string | null;
}

export interface CommentAutomationConfig {
  monitoring_enabled: boolean;
  private_reply_enabled: boolean;
  public_reply_enabled: boolean;
  confidence_threshold: number;
  escalation_threshold: number;
  cooldown_minutes: number;
  lead_keywords: string[];
}

export interface FollowUpConfig {
  max_follow_ups: number;
  interval_days: number;
  stop_on_reply: boolean;
  auto_enabled: boolean;
}

export interface RateLimitsConfig {
  comments_per_hour: number;
  dms_per_hour: number;
  public_replies_per_hour: number;
}

export interface HandoffConfig {
  auto_expire_hours: number;
  escalation_keywords: string[];
  low_confidence_threshold: number;
}

export interface BusinessConfig {
  businessId: string;

  // AI
  ai: {
    tone: string;
    style_instructions: string | null;
  };

  // Reply
  reply: {
    first_behaviour: string; // "smart_reply" | "simple_ack" | "disabled"
  };

  // Service
  service: {
    areas: string[];
    categories: string[];
  };

  // Business info
  business: BusinessInfo;

  // Comment automation
  comment: {
    automation: CommentAutomationConfig;
  };

  // Follow-ups
  followup: FollowUpConfig;

  // Rate limits
  rate_limits: RateLimitsConfig;

  // Handoff
  handoff: HandoffConfig;

  // Raw access for any custom keys
  raw: Record<string, unknown>;
}

// ============================================
// Defaults
// ============================================

const DEFAULT_CONFIG: Omit<BusinessConfig, "businessId" | "raw"> = {
  ai: {
    tone: "friendly",
    style_instructions: null,
  },
  reply: {
    first_behaviour: "smart_reply",
  },
  service: {
    areas: [],
    categories: [],
  },
  business: {
    name: null,
    description: null,
    contact_email: null,
    contact_phone: null,
    enquiry_form_url: null,
    service_type: null,
    callout_fee: null,
    quote_policy: null,
    emergency_available: false,
    after_hours_available: false,
    operating_hours: null,
  },
  comment: {
    automation: {
      monitoring_enabled: true,
      private_reply_enabled: true,
      public_reply_enabled: true,
      confidence_threshold: 0.4,
      escalation_threshold: 0.8,
      cooldown_minutes: 5,
      lead_keywords: [],
    },
  },
  followup: {
    max_follow_ups: 5,
    interval_days: 3,
    stop_on_reply: true,
    auto_enabled: false,
  },
  rate_limits: {
    comments_per_hour: 60,
    dms_per_hour: 30,
    public_replies_per_hour: 30,
  },
  handoff: {
    auto_expire_hours: 24,
    escalation_keywords: [],
    low_confidence_threshold: 0.3,
  },
};

// ============================================
// Cache
// ============================================

interface CacheEntry {
  config: BusinessConfig;
  ts: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get the full typed config for a business.
 * Reads from business_configs table, falls back to settings.
 */
export async function getBusinessConfig(
  businessId: string,
  opts?: { skipCache?: boolean }
): Promise<BusinessConfig> {
  // Check cache
  if (!opts?.skipCache) {
    const cached = cache.get(businessId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return cached.config;
    }
  }

  const supabase = db();

  // Load all config keys for this business
  const { data: rows } = await supabase
    .from("business_configs")
    .select("config_key, config_value")
    .eq("business_id", businessId);

  const rawMap: Record<string, unknown> = {};
  if (rows) {
    for (const row of rows) {
      rawMap[row.config_key] = row.config_value;
    }
  }

  // If no config rows, fall back to settings table
  if (!rows || rows.length === 0) {
    return loadConfigFromSettings(supabase, businessId);
  }

  // Build typed config from raw map
  const config = buildConfig(businessId, rawMap);

  // Cache it
  cache.set(businessId, { config, ts: Date.now() });

  return config;
}

/**
 * Update a single config key for a business.
 */
export async function setBusinessConfigKey(
  businessId: string,
  key: string,
  value: unknown,
  userId?: string
): Promise<void> {
  const supabase = db();

  await supabase
    .from("business_configs")
    .upsert(
      {
        business_id: businessId,
        config_key: key,
        config_value: value,
        updated_by: userId || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id,config_key" }
    );

  // Invalidate cache
  cache.delete(businessId);
}

/**
 * Update multiple config keys at once.
 */
export async function setBusinessConfigBatch(
  businessId: string,
  updates: Record<string, unknown>,
  userId?: string
): Promise<void> {
  const supabase = db();

  const rows = Object.entries(updates).map(([key, value]) => ({
    business_id: businessId,
    config_key: key,
    config_value: value,
    updated_by: userId || null,
    updated_at: new Date().toISOString(),
  }));

  await supabase
    .from("business_configs")
    .upsert(rows, { onConflict: "business_id,config_key" });

  cache.delete(businessId);
}

/**
 * Clear config cache for a business (or all businesses).
 */
export function clearConfigCache(businessId?: string): void {
  if (businessId) {
    cache.delete(businessId);
  } else {
    cache.clear();
  }
}

// ============================================
// Internal: build typed config from raw key/value map
// ============================================

function buildConfig(
  businessId: string,
  raw: Record<string, unknown>
): BusinessConfig {
  return {
    businessId,
    ai: {
      tone: extractString(raw["ai.tone"], DEFAULT_CONFIG.ai.tone),
      style_instructions: extractString(raw["ai.style_instructions"], null),
    },
    reply: {
      first_behaviour: extractString(
        raw["reply.first_behaviour"],
        DEFAULT_CONFIG.reply.first_behaviour
      ),
    },
    service: {
      areas: extractStringArray(raw["service.areas"], DEFAULT_CONFIG.service.areas),
      categories: extractStringArray(
        raw["service.categories"],
        DEFAULT_CONFIG.service.categories
      ),
    },
    business: {
      ...DEFAULT_CONFIG.business,
      ...(typeof raw["business.info"] === "object" && raw["business.info"] !== null
        ? (raw["business.info"] as Partial<BusinessInfo>)
        : {}),
    },
    comment: {
      automation: {
        ...DEFAULT_CONFIG.comment.automation,
        ...(typeof raw["comment.automation"] === "object" &&
        raw["comment.automation"] !== null
          ? (raw["comment.automation"] as Partial<CommentAutomationConfig>)
          : {}),
      },
    },
    followup: {
      ...DEFAULT_CONFIG.followup,
      ...(typeof raw["followup.config"] === "object" && raw["followup.config"] !== null
        ? (raw["followup.config"] as Partial<FollowUpConfig>)
        : {}),
    },
    rate_limits: {
      ...DEFAULT_CONFIG.rate_limits,
      ...(typeof raw["rate_limits"] === "object" && raw["rate_limits"] !== null
        ? (raw["rate_limits"] as Partial<RateLimitsConfig>)
        : {}),
    },
    handoff: {
      ...DEFAULT_CONFIG.handoff,
      ...(typeof raw["handoff.config"] === "object" && raw["handoff.config"] !== null
        ? (raw["handoff.config"] as Partial<HandoffConfig>)
        : {}),
    },
    raw,
  };
}

// ============================================
// Fallback: load config from legacy settings table
// ============================================

async function loadConfigFromSettings(
  supabase: DB,
  businessId: string
): Promise<BusinessConfig> {
  const { data: settings } = await supabase
    .from("settings")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  if (!settings) {
    // Return pure defaults
    const config: BusinessConfig = {
      businessId,
      ...DEFAULT_CONFIG,
      raw: {},
    };
    cache.set(businessId, { config, ts: Date.now() });
    return config;
  }

  const config: BusinessConfig = {
    businessId,
    ai: {
      tone: settings.ai_tone || DEFAULT_CONFIG.ai.tone,
      style_instructions: settings.ai_style_instructions || null,
    },
    reply: {
      first_behaviour:
        settings.first_reply_behaviour || DEFAULT_CONFIG.reply.first_behaviour,
    },
    service: {
      areas: settings.service_areas || [],
      categories: settings.service_categories || [],
    },
    business: {
      name: settings.business_name || null,
      description: settings.business_description || null,
      contact_email: settings.contact_email || null,
      contact_phone: settings.contact_phone || null,
      enquiry_form_url: settings.enquiry_form_url || null,
      service_type: settings.service_type || null,
      callout_fee: settings.callout_fee || null,
      quote_policy: settings.quote_policy || null,
      emergency_available: settings.emergency_available ?? false,
      after_hours_available: settings.after_hours_available ?? false,
      operating_hours: settings.operating_hours || null,
    },
    comment: {
      automation: {
        monitoring_enabled: settings.comment_monitoring_enabled ?? true,
        private_reply_enabled: settings.private_reply_enabled ?? true,
        public_reply_enabled: settings.public_reply_enabled ?? true,
        confidence_threshold: settings.comment_confidence_threshold ?? 0.4,
        escalation_threshold: settings.comment_escalation_threshold ?? 0.8,
        cooldown_minutes: settings.comment_cooldown_minutes ?? 5,
        lead_keywords: settings.comment_lead_keywords || [],
      },
    },
    followup: {
      max_follow_ups: settings.max_follow_ups ?? 5,
      interval_days: settings.follow_up_interval_days ?? 3,
      stop_on_reply: settings.stop_on_reply ?? true,
      auto_enabled: settings.auto_follow_up_enabled ?? false,
    },
    rate_limits: {
      comments_per_hour: settings.rate_limit_comments_per_hour ?? 60,
      dms_per_hour: settings.rate_limit_dms_per_hour ?? 30,
      public_replies_per_hour: settings.rate_limit_public_replies_per_hour ?? 30,
    },
    handoff: {
      auto_expire_hours: 24,
      escalation_keywords: settings.escalation_keywords || [],
      low_confidence_threshold: 0.3,
    },
    raw: {},
  };

  cache.set(businessId, { config, ts: Date.now() });
  return config;
}

// ============================================
// Type extraction helpers
// ============================================

function extractString(val: unknown, fallback: string): string;
function extractString(val: unknown, fallback: string | null): string | null;
function extractString(val: unknown, fallback: string | null): string | null {
  if (typeof val === "string") return val;
  if (val !== null && val !== undefined) return String(val);
  return fallback;
}

function extractStringArray(val: unknown, fallback: string[]): string[] {
  if (Array.isArray(val)) return val.map(String);
  return fallback;
}
