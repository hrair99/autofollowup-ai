// ============================================
// Facebook OAuth Initiate — GET /api/connect/facebook
// Redirects user to Meta Login Dialog to authorize page access.
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getUserBusinessId } from "@/lib/business/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const META_APP_ID = process.env.META_APP_ID || "2764382733907632";

// Permissions needed for page management, messaging, and comment automation
const SCOPES = [
  "pages_show_list",
  "pages_manage_metadata",
  "pages_messaging",
  "pages_read_engagement",
  "pages_manage_engagement",
  "pages_read_user_content",
  "leads_retrieval",
  "pages_manage_ads",
].join(",");

function getRedirectUri(): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";
  return `${base}/api/connect/facebook/callback`;
}

export async function GET(req: NextRequest) {
  // Must be authenticated
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Get business context
  const businessId = await getUserBusinessId(user.id);
  if (!businessId) {
    return NextResponse.json(
      { error: "No business found for user. Set up your business first." },
      { status: 400 }
    );
  }

  // Generate CSRF state token: base64(businessId:userId:timestamp)
  const statePayload = `${businessId}:${user.id}:${Date.now()}`;
  const state = Buffer.from(statePayload).toString("base64url");

  const loginUrl = new URL("https://www.facebook.com/v25.0/dialog/oauth");
  loginUrl.searchParams.set("client_id", META_APP_ID);
  loginUrl.searchParams.set("redirect_uri", getRedirectUri());
  loginUrl.searchParams.set("scope", SCOPES);
  loginUrl.searchParams.set("state", state);
  loginUrl.searchParams.set("response_type", "code");

  return NextResponse.redirect(loginUrl.toString());
}
