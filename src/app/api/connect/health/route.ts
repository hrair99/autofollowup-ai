// ============================================
// Meta Connection Health Check — GET /api/connect/health
// Checks token validity, permissions, and webhook subscription status
// ============================================

import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getUserBusinessId } from "@/lib/business/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PermissionStatus {
  permission: string;
  label: string;
  granted: boolean;
  required: boolean;
}

interface PageHealth {
  pageId: string;
  pageName: string;
  tokenValid: boolean;
  webhookSubscribed: boolean;
  permissions: PermissionStatus[];
  tokenExpiresAt: string | null;
}

interface HealthResponse {
  hasUserToken: boolean;
  tokenDebugInfo: { isValid: boolean; expiresAt: string | null; scopes: string[] } | null;
  pages: PageHealth[];
}

// Required permissions for full functionality
const REQUIRED_PERMISSIONS = [
  { permission: "pages_manage_metadata", label: "Page Management", required: true },
  { permission: "pages_messaging", label: "Messaging", required: true },
  { permission: "pages_read_engagement", label: "Read Engagement", required: true },
  { permission: "pages_manage_posts", label: "Manage Posts", required: false },
  { permission: "pages_read_user_content", label: "Read User Content", required: true },
  { permission: "leads_retrieval", label: "Lead Ads", required: false },
];

export async function GET() {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = await getUserBusinessId(user.id);
  if (!businessId) {
    return NextResponse.json({ error: "No business" }, { status: 404 });
  }

  // Get business token
  const { data: biz } = await supabase
    .from("businesses")
    .select("meta_user_token")
    .eq("id", businessId)
    .single();

  const result: HealthResponse = {
    hasUserToken: !!biz?.meta_user_token,
    tokenDebugInfo: null,
    pages: [],
  };

  if (!biz?.meta_user_token) {
    return NextResponse.json(result);
  }

  const token = biz.meta_user_token;

  // Debug the user token
  try {
    const debugRes = await fetch(
      `https://graph.facebook.com/v25.0/debug_token?input_token=${token}&access_token=${token}`
    );
    const debugData = await debugRes.json();

    if (debugData.data) {
      const d = debugData.data;
      result.tokenDebugInfo = {
        isValid: d.is_valid === true,
        expiresAt: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : null,
        scopes: d.scopes || [],
      };
    }
  } catch (err) {
    console.warn("[connect/health] Token debug failed:", err);
  }

  // Get connected pages
  const { data: pages } = await supabase
    .from("business_pages")
    .select("page_id, page_name, access_token, is_active, token_status")
    .eq("business_id", businessId);

  if (pages && pages.length > 0) {
    for (const page of pages) {
      const pageHealth: PageHealth = {
        pageId: page.page_id,
        pageName: page.page_name || page.page_id,
        tokenValid: page.token_status === "valid",
        webhookSubscribed: false,
        permissions: REQUIRED_PERMISSIONS.map((p) => ({
          ...p,
          granted: result.tokenDebugInfo?.scopes?.includes(p.permission) ?? false,
        })),
        tokenExpiresAt: null,
      };

      // Check page token and webhook subscription
      if (page.access_token) {
        try {
          // Check subscribed apps (webhook subscription)
          const subRes = await fetch(
            `https://graph.facebook.com/v25.0/${page.page_id}/subscribed_apps?access_token=${page.access_token}`
          );
          const subData = await subRes.json();

          if (subData.data && subData.data.length > 0) {
            pageHealth.webhookSubscribed = true;
          }

          // Debug the page token
          const pageDebugRes = await fetch(
            `https://graph.facebook.com/v25.0/debug_token?input_token=${page.access_token}&access_token=${token}`
          );
          const pageDebug = await pageDebugRes.json();
          if (pageDebug.data) {
            pageHealth.tokenValid = pageDebug.data.is_valid === true;
            pageHealth.tokenExpiresAt = pageDebug.data.expires_at
              ? new Date(pageDebug.data.expires_at * 1000).toISOString()
              : null;
          }
        } catch (err) {
          console.warn(`[connect/health] Page ${page.page_id} check failed:`, err);
        }
      }

      result.pages.push(pageHealth);
    }
  }

  return NextResponse.json(result);
}
