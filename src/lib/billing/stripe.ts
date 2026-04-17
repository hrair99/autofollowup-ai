// ============================================
// Stripe Billing — Core billing module
// Manages subscriptions, usage gates, and plan enforcement
// ============================================

import { createClient } from "@supabase/supabase-js";

// Lazy-load Stripe to avoid import errors when not installed
let _stripe: any = null;
function getStripe() {
  if (!_stripe) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Stripe = require("stripe");
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2024-12-18.acacia",
    });
  }
  return _stripe;
}

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ============================================
// Plan definitions
// ============================================

export interface PlanLimits {
  comments_per_month: number;  // -1 = unlimited
  dms_per_month: number;
  ai_calls_per_month: number;
  max_pages: number;
}

const PLAN_LIMITS: Record<string, PlanLimits> = {
  free:      { comments_per_month: 500,  dms_per_month: 300,  ai_calls_per_month: 1000, max_pages: 1 },
  starter:   { comments_per_month: 2000, dms_per_month: 1500, ai_calls_per_month: 5000, max_pages: 2 },
  pro:       { comments_per_month: 10000,dms_per_month: 8000, ai_calls_per_month: 25000,max_pages: 5 },
  unlimited: { comments_per_month: -1,   dms_per_month: -1,   ai_calls_per_month: -1,   max_pages: -1 },
};

// Stripe Price IDs (set in env or hardcode after creating in Stripe dashboard)
export const STRIPE_PRICES: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_STARTER || "",
  pro: process.env.STRIPE_PRICE_PRO || "",
  unlimited: process.env.STRIPE_PRICE_UNLIMITED || "",
};

export function getPlanLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

// ============================================
// Subscription status check
// ============================================

export interface SubscriptionGate {
  allowed: boolean;
  reason: string;
  plan: string;
  subscriptionStatus: string;
}

/**
 * Check if a business is allowed to run automation.
 * Returns false only if a paid subscription is explicitly canceled/unpaid.
 * Free plan and businesses without a plan set are always allowed through.
 */
export async function checkSubscriptionGate(businessId: string): Promise<SubscriptionGate> {
  const supabase = getServiceClient();

  const { data: biz, error } = await supabase
    .from("businesses")
    .select("plan, subscription_status, onboarding_completed")
    .eq("id", businessId)
    .single();

  if (error || !biz) {
    // If we can't read the business, let jobs through rather than silently dropping them
    console.warn(`[SubscriptionGate] Could not read business ${businessId}: ${error?.message || "not found"} — allowing through`);
    return { allowed: true, reason: "business_read_error_passthrough", plan: "free", subscriptionStatus: "none" };
  }

  const plan = biz.plan || "free";
  const status = biz.subscription_status || "none";

  // Free plan or no plan set — always allowed (usage limits checked separately)
  if (plan === "free" || !biz.plan) {
    return { allowed: true, reason: "free_plan", plan, subscriptionStatus: status };
  }

  // Paid plans: must have active subscription
  if (status === "active" || status === "trialing") {
    return { allowed: true, reason: "subscription_active", plan, subscriptionStatus: status };
  }

  // Past due — allow but warn (Stripe retries payment)
  if (status === "past_due") {
    return { allowed: true, reason: "subscription_past_due", plan, subscriptionStatus: status };
  }

  // No status set yet (e.g. just upgraded, webhook hasn't fired) — allow through
  if (!status || status === "none") {
    return { allowed: true, reason: "no_subscription_status_yet", plan, subscriptionStatus: status };
  }

  // Canceled, unpaid, etc.
  return { allowed: false, reason: "subscription_inactive", plan, subscriptionStatus: status };
}

// ============================================
// Usage tracking + limits
// ============================================

export interface UsageCheck {
  allowed: boolean;
  reason: string;
  current: number;
  limit: number;
  percentUsed: number;
}

/**
 * Check if business is within usage limits for a specific metric.
 * Also increments usage if within limits.
 *
 * IMPORTANT: This function is fail-open — if usage tracking fails
 * (table doesn't exist, RPC not found, etc.) it allows the action
 * through. We never want billing infrastructure to silently kill
 * the core automation pipeline.
 */
export async function checkAndIncrementUsage(
  businessId: string,
  metric: "comments_processed" | "dms_sent" | "ai_calls" | "public_replies_sent",
  plan?: string
): Promise<UsageCheck> {
  try {
    const supabase = getServiceClient();
    const period = new Date().toISOString().slice(0, 7); // YYYY-MM

    // Get plan if not provided
    if (!plan) {
      const { data: biz } = await supabase
        .from("businesses")
        .select("plan")
        .eq("id", businessId)
        .single();
      plan = biz?.plan || "free";
    }

    const limits = getPlanLimits(plan || "free");

    // Map metric to limit field
    const limitMap: Record<string, number> = {
      comments_processed: limits.comments_per_month,
      dms_sent: limits.dms_per_month,
      ai_calls: limits.ai_calls_per_month,
      public_replies_sent: limits.comments_per_month, // Same bucket as comments
    };

    const limit = limitMap[metric] ?? 0;

    // Unlimited plan
    if (limit === -1) {
      // Still increment for tracking, but always allow
      await safeIncrementUsage(supabase, businessId, metric, period);
      return { allowed: true, reason: "unlimited", current: 0, limit: -1, percentUsed: 0 };
    }

    // Get current usage
    const { data: usage, error: usageError } = await supabase
      .from("business_usage")
      .select(metric)
      .eq("business_id", businessId)
      .eq("period", period)
      .maybeSingle();

    if (usageError) {
      // Table might not exist yet — allow through
      console.warn(`[UsageCheck] Failed to read usage for ${businessId}: ${usageError.message} — allowing through`);
      return { allowed: true, reason: "usage_read_error_passthrough", current: 0, limit, percentUsed: 0 };
    }

    const current = (usage as Record<string, number> | null)?.[metric] || 0;

    if (current >= limit) {
      return {
        allowed: false,
        reason: `usage_limit_exceeded:${metric}`,
        current,
        limit,
        percentUsed: 100,
      };
    }

    // Increment (non-blocking — don't fail the job if increment fails)
    await safeIncrementUsage(supabase, businessId, metric, period);

    return {
      allowed: true,
      reason: "within_limit",
      current: current + 1,
      limit,
      percentUsed: Math.round(((current + 1) / limit) * 100),
    };
  } catch (error) {
    // Fail-open: if anything in the usage check throws, allow through
    console.error(`[UsageCheck] Unexpected error for ${businessId}/${metric}: ${error} — allowing through`);
    return { allowed: true, reason: "usage_check_error_passthrough", current: 0, limit: 0, percentUsed: 0 };
  }
}

/**
 * Safely increment usage — upserts the row if it doesn't exist,
 * and swallows errors to avoid breaking the main pipeline.
 */
async function safeIncrementUsage(
  supabase: any,
  businessId: string,
  metric: string,
  period: string
): Promise<void> {
  try {
    // Try the RPC first
    const { error: rpcError } = await supabase.rpc("increment_usage", {
      p_business_id: businessId,
      p_field: metric,
      p_amount: 1,
    });

    if (rpcError) {
      // RPC might not exist — try direct upsert as fallback
      console.warn(`[UsageCheck] increment_usage RPC failed: ${rpcError.message} — trying direct upsert`);

      // First try to insert a new row
      const { error: insertError } = await supabase
        .from("business_usage")
        .upsert(
          {
            business_id: businessId,
            period,
            [metric]: 1,
          },
          { onConflict: "business_id,period" }
        );

      if (insertError) {
        console.warn(`[UsageCheck] Direct upsert also failed: ${insertError.message} — skipping usage tracking`);
      }
    }
  } catch (e) {
    // Non-critical — don't let usage tracking break automation
    console.warn(`[UsageCheck] safeIncrementUsage failed: ${e}`);
  }
}

/**
 * Get current usage summary for a business.
 */
export async function getUsageSummary(businessId: string, plan?: string) {
  const supabase = getServiceClient();
  const period = new Date().toISOString().slice(0, 7);

  if (!plan) {
    const { data: biz } = await supabase
      .from("businesses")
      .select("plan")
      .eq("id", businessId)
      .single();
    plan = biz?.plan || "free";
  }

  const limits = getPlanLimits(plan || "free");

  const { data: usage } = await supabase
    .from("business_usage")
    .select("*")
    .eq("business_id", businessId)
    .eq("period", period)
    .maybeSingle();

  return {
    period,
    plan,
    usage: {
      comments_processed: usage?.comments_processed || 0,
      dms_sent: usage?.dms_sent || 0,
      ai_calls: usage?.ai_calls || 0,
      public_replies_sent: usage?.public_replies_sent || 0,
      leads_created: usage?.leads_created || 0,
    },
    limits,
  };
}

// ============================================
// Stripe operations
// ============================================

/**
 * Create a Stripe checkout session for a plan upgrade.
 */
export async function createCheckoutSession(
  businessId: string,
  planName: string,
  successUrl: string,
  cancelUrl: string
): Promise<{ url: string } | { error: string }> {
  const stripe = getStripe();
  const supabase = getServiceClient();

  const priceId = STRIPE_PRICES[planName];
  if (!priceId) {
    return { error: `No Stripe price configured for plan: ${planName}` };
  }

  // Get or create Stripe customer
  const { data: biz } = await supabase
    .from("businesses")
    .select("stripe_customer_id, contact_email, business_name, name, owner_id")
    .eq("id", businessId)
    .single();

  if (!biz) return { error: "Business not found" };

  let customerId = biz.stripe_customer_id;

  if (!customerId) {
    // Get owner email
    const { data: userData } = await supabase.auth.admin.getUserById(biz.owner_id);
    const email = userData?.user?.email || biz.contact_email;

    const customer = await stripe.customers.create({
      email,
      name: biz.business_name || biz.name,
      metadata: { business_id: businessId },
    });
    customerId = customer.id;

    await supabase
      .from("businesses")
      .update({ stripe_customer_id: customerId })
      .eq("id", businessId);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { business_id: businessId, plan: planName },
    subscription_data: {
      metadata: { business_id: businessId, plan: planName },
    },
  });

  return { url: session.url };
}

/**
 * Create a Stripe billing portal session.
 */
export async function createPortalSession(
  businessId: string,
  returnUrl: string
): Promise<{ url: string } | { error: string }> {
  const stripe = getStripe();
  const supabase = getServiceClient();

  const { data: biz } = await supabase
    .from("businesses")
    .select("stripe_customer_id")
    .eq("id", businessId)
    .single();

  if (!biz?.stripe_customer_id) {
    return { error: "No Stripe customer found. Subscribe to a plan first." };
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: biz.stripe_customer_id,
    return_url: returnUrl,
  });

  return { url: session.url };
}

/**
 * Handle Stripe webhook events.
 * Updates business subscription status in our DB.
 */
export async function handleStripeEvent(event: {
  type: string;
  data: { object: any };
}): Promise<void> {
  const supabase = getServiceClient();
  const obj = event.data.object;

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const businessId = obj.metadata?.business_id;
      const plan = obj.metadata?.plan;
      if (!businessId) {
        // Try to find by customer ID
        const customerId = obj.customer;
        const { data: biz } = await supabase
          .from("businesses")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();
        if (biz) {
          await updateSubscription(supabase, biz.id, obj, plan);
        }
      } else {
        await updateSubscription(supabase, businessId, obj, plan);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const customerId = obj.customer;
      const { data: biz } = await supabase
        .from("businesses")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();

      if (biz) {
        await supabase
          .from("businesses")
          .update({
            subscription_status: "canceled",
            plan: "free",
            updated_at: new Date().toISOString(),
          })
          .eq("id", biz.id);
      }
      break;
    }

    case "invoice.payment_failed": {
      const customerId = obj.customer;
      const { data: biz } = await supabase
        .from("businesses")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();

      if (biz) {
        await supabase
          .from("businesses")
          .update({
            subscription_status: "past_due",
            updated_at: new Date().toISOString(),
          })
          .eq("id", biz.id);

        // Create alert
        await supabase.from("business_alerts").insert({
          business_id: biz.id,
          alert_type: "payment_failed",
          severity: "critical",
          message: "Payment failed. Please update your billing details to keep automation running.",
          metadata: { invoice_id: obj.id },
        });
      }
      break;
    }
  }
}

async function updateSubscription(
  supabase: any,
  businessId: string,
  subscription: any,
  plan?: string
) {
  const statusMap: Record<string, string> = {
    active: "active",
    trialing: "trialing",
    past_due: "past_due",
    canceled: "canceled",
    unpaid: "canceled",
    incomplete: "canceled",
    incomplete_expired: "canceled",
  };

  await supabase
    .from("businesses")
    .update({
      stripe_subscription_id: subscription.id,
      subscription_status: statusMap[subscription.status] || subscription.status,
      plan: plan || "starter",
      updated_at: new Date().toISOString(),
    })
    .eq("id", businessId);
}
