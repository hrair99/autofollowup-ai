// ============================================
// Facebook OAuth Callback — GET /api/connect/facebook/callback
// Exchanges authorization code for long-lived user token,
// fetches available pages, stores user token temporarily,
// then redirects to page selection UI.
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const META_APP_ID = process.env.META_APP_ID || "2764382733907632";
const META_APP_SECRET = process.env.META_APP_SECRET || "";

function getRedirectUri(): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";
  return `${base}/api/connect/facebook/callback`;
}

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorReason = url.searchParams.get("error_reason");

  const appBase =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";

  // User denied permissions
  if (error) {
    const connectUrl = new URL("/connect", appBase);
    connectUrl.searchParams.set(
      "error",
      errorReason || error || "oauth_denied"
    );
    return NextResponse.redirect(connectUrl.toString());
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${appBase}/connect?error=missing_code_or_state`
    );
  }

  // Decode state to get businessId and userId
  let businessId: string;
  let userId: string;
  try {
    const decoded = Buffer.from(state, "base64url").toString();
    const parts = decoded.split(":");
    businessId = parts[0];
    userId = parts[1];
    if (!businessId || !userId) throw new Error("invalid_state");
  } catch {
    return NextResponse.redirect(`${appBase}/connect?error=invalid_state`);
  }

  // Verify user is authenticated and matches state
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.id !== userId) {
    return NextResponse.redirect(
      `${appBase}/connect?error=auth_mismatch`
    );
  }

  if (!META_APP_SECRET) {
    return NextResponse.redirect(
      `${appBase}/connect?error=server_config_missing`
    );
  }

  try {
    // 1. Exchange code for short-lived user token
    const tokenUrl =
      `https://graph.facebook.com/v25.0/oauth/access_token` +
      `?client_id=${META_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(getRedirectUri())}` +
      `&client_secret=${encodeURIComponent(META_APP_SECRET)}` +
      `&code=${encodeURIComponent(code)}`;

    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("[OAuth] Code exchange failed:", tokenData);
      return NextResponse.redirect(
        `${appBase}/connect?error=token_exchange_failed`
      );
    }

    const shortLivedToken = tokenData.access_token as string;

    // 2. Exchange short-lived for long-lived user token (~60 days)
    const llUrl =
      `https://graph.facebook.com/v25.0/oauth/access_token` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${META_APP_ID}` +
      `&client_secret=${encodeURIComponent(META_APP_SECRET)}` +
      `&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`;

    const llRes = await fetch(llUrl);
    const llData = await llRes.json();

    if (!llRes.ok || !llData.access_token) {
      console.error("[OAuth] Long-lived exchange failed:", llData);
      return NextResponse.redirect(
        `${appBase}/connect?error=token_exchange_failed`
      );
    }

    const longLivedUserToken = llData.access_token as string;
    const expiresIn = (llData.expires_in as number) || 5184000; // ~60 days

    // 3. Store long-lived user token temporarily in businesses table
    //    (we'll use it to fetch pages on the selection screen)
    const serviceClient = getServiceClient();
    await serviceClient
      .from("businesses")
      .update({
        meta_user_token: longLivedUserToken,
        meta_token_expires_at: new Date(
          Date.now() + expiresIn * 1000
        ).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", businessId);

    // Redirect to page selection
    return NextResponse.redirect(`${appBase}/connect?step=select_pages`);
  } catch (e) {
    console.error("[OAuth] Callback error:", e);
    return NextResponse.redirect(
      `${appBase}/connect?error=unexpected_error`
    );
  }
}
