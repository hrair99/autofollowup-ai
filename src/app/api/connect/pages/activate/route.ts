// ============================================
// Activate Page — POST /api/connect/pages/activate
// Saves the page token to business_pages, subscribes to webhooks,
// and marks the page as active for automation.
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { getUserBusinessId, clearPageCache } from "@/lib/business/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUBSCRIBED_FIELDS = [
  "messages",
  "messaging_postbacks",
  "messaging_optins",
  "message_deliveries",
  "message_reads",
  "feed",
  "leadgen",
];

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface ActivateBody {
  pageId: string;
  pageName?: string;
}

export async function POST(req: NextRequest) {
  // Auth check
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = await getUserBusinessId(user.id);
  if (!businessId) {
    return NextResponse.json(
      { error: "No business found" },
      { status: 400 }
    );
  }

  let body: ActivateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { pageId, pageName } = body;
  if (!pageId) {
    return NextResponse.json(
      { error: "pageId is required" },
      { status: 400 }
    );
  }

  const serviceClient = getServiceClient();

  // Get the stored user token to fetch this page's token
  const { data: biz } = await serviceClient
    .from("businesses")
    .select("meta_user_token")
    .eq("id", businessId)
    .single();

  if (!biz?.meta_user_token) {
    return NextResponse.json(
      { error: "no_user_token", message: "Connect Facebook account first." },
      { status: 400 }
    );
  }

  try {
    // Fetch the specific page's access token from Meta
    const pageTokenRes = await fetch(
      `https://graph.facebook.com/v25.0/${pageId}?fields=access_token,name&access_token=${encodeURIComponent(biz.meta_user_token)}`
    );
    const pageTokenData = await pageTokenRes.json();

    if (!pageTokenRes.ok || !pageTokenData.access_token) {
      console.error("[Activate] Failed to get page token:", pageTokenData);
      return NextResponse.json(
        {
          error: "page_token_failed",
          message:
            pageTokenData.error?.message ||
            "Could not get access token for this page.",
        },
        { status: 502 }
      );
    }

    const pageToken = pageTokenData.access_token as string;
    const resolvedName = pageName || pageTokenData.name || `Page ${pageId}`;

    // Subscribe to webhooks using the page token
    const subscribeRes = await fetch(
      `https://graph.facebook.com/v25.0/${pageId}/subscribed_apps?access_token=${encodeURIComponent(pageToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscribed_fields: SUBSCRIBED_FIELDS.join(","),
        }),
      }
    );
    const subscribeData = await subscribeRes.json();

    if (!subscribeRes.ok || !subscribeData.success) {
      console.error("[Activate] Subscribe failed:", subscribeData);
      // Not fatal — page may still work for some events, continue
    }

    // Upsert into business_pages
    const { data: savedPage, error: upsertError } = await serviceClient
      .from("business_pages")
      .upsert(
        {
          business_id: businessId,
          page_id: pageId,
          page_name: resolvedName,
          access_token: pageToken,
          is_active: true,
          subscribed_fields: SUBSCRIBED_FIELDS,
          token_status: "valid",
          token_expires_at: null, // Page tokens from long-lived user tokens don't expire
          updated_at: new Date().toISOString(),
        },
        { onConflict: "business_id,page_id" }
      )
      .select()
      .single();

    if (upsertError) {
      console.error("[Activate] DB upsert error:", upsertError);
      return NextResponse.json(
        { error: "db_error", message: upsertError.message },
        { status: 500 }
      );
    }

    // Also update settings.meta_page_id for backwards compat
    await serviceClient
      .from("settings")
      .update({ meta_page_id: pageId })
      .eq("business_id", businessId);

    // Clear business resolution cache for this page
    clearPageCache(pageId);

    return NextResponse.json({
      ok: true,
      page: {
        id: savedPage.page_id,
        name: savedPage.page_name,
        active: savedPage.is_active,
        subscribedFields: SUBSCRIBED_FIELDS,
      },
      subscribeResult: subscribeData,
    });
  } catch (e) {
    console.error("[Activate] Error:", e);
    return NextResponse.json(
      { error: "unexpected_error", message: String(e) },
      { status: 500 }
    );
  }
}

/**
 * DELETE — Disconnect a page (deactivate, don't delete).
 */
export async function DELETE(req: NextRequest) {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = await getUserBusinessId(user.id);
  if (!businessId) {
    return NextResponse.json(
      { error: "No business found" },
      { status: 400 }
    );
  }

  let body: { pageId: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const serviceClient = getServiceClient();

  const { error } = await serviceClient
    .from("business_pages")
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", businessId)
    .eq("page_id", body.pageId);

  if (error) {
    return NextResponse.json(
      { error: "db_error", message: error.message },
      { status: 500 }
    );
  }

  clearPageCache(body.pageId);

  return NextResponse.json({ ok: true, disconnected: body.pageId });
}
