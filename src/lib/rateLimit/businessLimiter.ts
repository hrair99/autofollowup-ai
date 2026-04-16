// ============================================
// Business Rate Limiter — Per-business action throttling
// Prevents spam by enforcing hourly limits on automated actions.
// ============================================

import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface RateLimitConfig {
  commentsPerHour: number;
  dmsPerHour: number;
  publicRepliesPerHour: number;
}

export interface RateLimitCheck {
  allowed: boolean;
  reason: string;
  currentCount: number;
  limit: number;
  resetAt: string; // ISO timestamp when the window resets
}

const DEFAULT_LIMITS: RateLimitConfig = {
  commentsPerHour: 30,
  dmsPerHour: 20,
  publicRepliesPerHour: 25,
};

/**
 * Check if a business can perform an action type within its rate limits.
 * Counts actions in the last hour from automation_logs.
 */
export async function checkRateLimit(
  businessId: string,
  actionType: "comment" | "dm" | "public_reply",
  customLimits?: Partial<RateLimitConfig>
): Promise<RateLimitCheck> {
  const supabase = getServiceClient();
  const limits = { ...DEFAULT_LIMITS, ...customLimits };

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  // Map action type to the log filter and limit
  const actionMap: Record<string, { filter: string; limit: number }> = {
    comment: {
      filter: "comment_automation",
      limit: limits.commentsPerHour,
    },
    dm: {
      filter: "send_private_reply",
      limit: limits.dmsPerHour,
    },
    public_reply: {
      filter: "public_reply",
      limit: limits.publicRepliesPerHour,
    },
  };

  const config = actionMap[actionType];
  if (!config) {
    return { allowed: true, reason: "unknown_action_type", currentCount: 0, limit: 0, resetAt };
  }

  // Count recent actions for this business
  const { count, error } = await supabase
    .from("automation_logs")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("success", true)
    .gte("created_at", oneHourAgo)
    .or(`event_type.eq.${config.filter},action_taken.eq.${config.filter}`);

  if (error) {
    console.error("[RateLimit] Count error:", error);
    // Fail open — allow action if we can't check
    return { allowed: true, reason: "count_error", currentCount: 0, limit: config.limit, resetAt };
  }

  const currentCount = count || 0;

  if (currentCount >= config.limit) {
    return {
      allowed: false,
      reason: `rate_limit_exceeded:${actionType}:${currentCount}/${config.limit}/hr`,
      currentCount,
      limit: config.limit,
      resetAt,
    };
  }

  return {
    allowed: true,
    reason: "within_limit",
    currentCount,
    limit: config.limit,
    resetAt,
  };
}

/**
 * Load rate limit config from business settings.
 */
export async function loadRateLimits(businessId: string): Promise<RateLimitConfig> {
  const supabase = getServiceClient();

  const { data } = await supabase
    .from("settings")
    .select(
      "rate_limit_comments_per_hour, rate_limit_dms_per_hour, rate_limit_public_replies_per_hour"
    )
    .eq("business_id", businessId)
    .maybeSingle();

  if (!data) return DEFAULT_LIMITS;

  return {
    commentsPerHour: data.rate_limit_comments_per_hour || DEFAULT_LIMITS.commentsPerHour,
    dmsPerHour: data.rate_limit_dms_per_hour || DEFAULT_LIMITS.dmsPerHour,
    publicRepliesPerHour:
      data.rate_limit_public_replies_per_hour || DEFAULT_LIMITS.publicRepliesPerHour,
  };
}

/**
 * Quick rate limit check — combines loading config + checking.
 * Used by handlers before executing actions.
 */
export async function canPerformAction(
  businessId: string,
  actionType: "comment" | "dm" | "public_reply"
): Promise<RateLimitCheck> {
  const limits = await loadRateLimits(businessId);
  return checkRateLimit(businessId, actionType, limits);
}
