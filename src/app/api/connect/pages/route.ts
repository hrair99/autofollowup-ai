// ============================================
// List Available Pages — GET /api/connect/pages
// Fetches pages the user manages from Meta using the stored
// long-lived user token. Returns page list for selection UI.
// ============================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { getUserBusinessId } from "@/lib/business/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  category?: string;
  tasks?: string[];
}

export async function GET() {
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

  // Get stored user token
  const serviceClient = getServiceClient();
  const { data: biz } = await serviceClient
    .from("businesses")
    .select("meta_user_token, meta_token_expires_at")
    .eq("id", businessId)
    .single();

  if (!biz?.meta_user_token) {
    return NextResponse.json(
      { error: "no_token", message: "Connect your Facebook account first." },
      { status: 400 }
    );
  }

  // Check if token is expired
  if (
    biz.meta_token_expires_at &&
    new Date(biz.meta_token_expires_at) < new Date()
  ) {
    return NextResponse.json(
      { error: "token_expired", message: "Your Facebook token has expired. Please reconnect." },
      { status: 400 }
    );
  }

  try {
    // Fetch pages from Meta
    const pages: MetaPage[] = [];
    let url: string | null =
      `https://graph.facebook.com/v25.0/me/accounts?fields=id,name,access_token,category,tasks&limit=100&access_token=${encodeURIComponent(biz.meta_user_token)}`;

    // Handle pagination
    while (url) {
      const res: Response = await fetch(url);
      const data = await res.json();

      if (!res.ok || data.error) {
        console.error("[Pages] Meta API error:", data.error);
        return NextResponse.json(
          {
            error: "meta_api_error",
            message: data.error?.message || "Failed to fetch pages",
          },
          { status: 502 }
        );
      }

      if (data.data) {
        pages.push(...data.data);
      }

      url = data.paging?.next || null;
    }

    // Also fetch which pages are already connected
    const { data: connectedPages } = await serviceClient
      .from("business_pages")
      .select("page_id, is_active")
      .eq("business_id", businessId);

    const connectedPageIds = new Set(
      (connectedPages || []).map((p) => p.page_id)
    );
    const activePageIds = new Set(
      (connectedPages || []).filter((p) => p.is_active).map((p) => p.page_id)
    );

    return NextResponse.json({
      pages: pages.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category || null,
        connected: connectedPageIds.has(p.id),
        active: activePageIds.has(p.id),
      })),
      businessId,
    });
  } catch (e) {
    console.error("[Pages] Error:", e);
    return NextResponse.json(
      { error: "unexpected_error", message: String(e) },
      { status: 500 }
    );
  }
}
