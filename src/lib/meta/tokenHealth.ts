// ============================================
// Token Health — Validates and monitors page tokens
// Used by cron jobs to detect expiring/invalid tokens
// ============================================

import { createClient } from "@supabase/supabase-js";

const META_APP_ID = process.env.META_APP_ID || "2764382733907632";
const META_APP_SECRET = process.env.META_APP_SECRET || "";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface TokenHealthResult {
  pageId: string;
  pageName: string | null;
  businessId: string;
  status: "valid" | "expiring" | "expired" | "invalid";
  isValid: boolean;
  expiresAt: string | null;
  scopes: string[];
  error?: string;
}

/**
 * Debug a single token via Meta's debug_token endpoint.
 */
async function debugToken(token: string): Promise<{
  isValid: boolean;
  expiresAt: number | null;
  scopes: string[];
  error?: string;
}> {
  if (!META_APP_SECRET) {
    return { isValid: false, expiresAt: null, scopes: [], error: "no_app_secret" };
  }

  try {
    const appToken = `${META_APP_ID}|${META_APP_SECRET}`;
    const res = await fetch(
      `https://graph.facebook.com/v25.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`
    );
    const data = await res.json();

    if (!res.ok || !data.data) {
      return {
        isValid: false,
        expiresAt: null,
        scopes: [],
        error: data.error?.message || "debug_token_failed",
      };
    }

    const info = data.data;
    const isValid = info.is_valid === true;
    const expiresAt = info.expires_at && info.expires_at > 0
      ? info.expires_at
      : null; // 0 means never expires
    const scopes = info.scopes || [];

    return { isValid, expiresAt, scopes };
  } catch (e) {
    return { isValid: false, expiresAt: null, scopes: [], error: String(e) };
  }
}

/**
 * Check health of all active page tokens.
 * Updates token_status in business_pages.
 */
export async function checkAllTokenHealth(): Promise<TokenHealthResult[]> {
  const supabase = getServiceClient();
  const results: TokenHealthResult[] = [];

  const { data: pages } = await supabase
    .from("business_pages")
    .select("page_id, page_name, business_id, access_token, token_status")
    .eq("is_active", true);

  if (!pages || pages.length === 0) return results;

  for (const page of pages) {
    const debug = await debugToken(page.access_token);

    let status: TokenHealthResult["status"] = "valid";
    if (!debug.isValid) {
      status = "invalid";
    } else if (debug.expiresAt) {
      const expiresDate = new Date(debug.expiresAt * 1000);
      const daysUntilExpiry =
        (expiresDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysUntilExpiry <= 0) {
        status = "expired";
      } else if (daysUntilExpiry <= 7) {
        status = "expiring";
      }
    }

    // Update status in DB if changed
    if (page.token_status !== status) {
      await supabase
        .from("business_pages")
        .update({
          token_status: status,
          token_expires_at: debug.expiresAt
            ? new Date(debug.expiresAt * 1000).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        })
        .eq("business_id", page.business_id)
        .eq("page_id", page.page_id);
    }

    results.push({
      pageId: page.page_id,
      pageName: page.page_name,
      businessId: page.business_id,
      status,
      isValid: debug.isValid,
      expiresAt: debug.expiresAt
        ? new Date(debug.expiresAt * 1000).toISOString()
        : null,
      scopes: debug.scopes,
      error: debug.error,
    });
  }

  return results;
}

/**
 * Refresh a page token using the business's stored user token.
 * Called when a token is detected as expiring or after user reconnects.
 */
export async function refreshPageToken(
  businessId: string,
  pageId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getServiceClient();

  // Get the business's user token
  const { data: biz } = await supabase
    .from("businesses")
    .select("meta_user_token, meta_token_expires_at")
    .eq("id", businessId)
    .single();

  if (!biz?.meta_user_token) {
    return { ok: false, error: "no_user_token" };
  }

  // Check if user token is expired
  if (
    biz.meta_token_expires_at &&
    new Date(biz.meta_token_expires_at) < new Date()
  ) {
    return { ok: false, error: "user_token_expired" };
  }

  try {
    // Fetch fresh page token
    const res = await fetch(
      `https://graph.facebook.com/v25.0/${pageId}?fields=access_token&access_token=${encodeURIComponent(biz.meta_user_token)}`
    );
    const data = await res.json();

    if (!res.ok || !data.access_token) {
      return {
        ok: false,
        error: data.error?.message || "page_token_fetch_failed",
      };
    }

    // Update in DB
    await supabase
      .from("business_pages")
      .update({
        access_token: data.access_token,
        token_status: "valid",
        token_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("business_id", businessId)
      .eq("page_id", pageId);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
