// ============================================
// Token Refresh Helper
// Takes a short-lived user token, exchanges it for a long-lived user token,
// then fetches the never-expires page token for META_PAGE_ID.
// Protected by CRON_SECRET.
// ============================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function auth(request: Request): boolean {
  const header = request.headers.get("authorization") || "";
  const secret = header.replace(/^Bearer\s+/, "");
  return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
}

interface AccountsPageItem {
  id: string;
  access_token: string;
  name?: string;
}

interface AccountsResponse {
  data?: AccountsPageItem[];
}

export async function POST(request: Request) {
  if (!auth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appId = process.env.META_APP_ID || "2764382733907632";
  const appSecret = process.env.META_APP_SECRET;
  const pageId = process.env.META_PAGE_ID;

  if (!appSecret) {
    return NextResponse.json({ error: "META_APP_SECRET not set" }, { status: 500 });
  }
  if (!pageId) {
    return NextResponse.json({ error: "META_PAGE_ID not set" }, { status: 500 });
  }

  let body: { userToken?: string; pageIds?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userToken = body.userToken?.trim();
  if (!userToken) {
    return NextResponse.json({ error: "userToken required in body" }, { status: 400 });
  }

  // Support refreshing multiple pages — defaults to META_PAGE_ID env var
  const targetPageIds = body.pageIds?.length ? body.pageIds : [pageId];

  try {
    // 1. Exchange short-lived user token for long-lived user token (~60d)
    const exchangeUrl =
      `https://graph.facebook.com/v25.0/oauth/access_token` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${encodeURIComponent(appId)}` +
      `&client_secret=${encodeURIComponent(appSecret)}` +
      `&fb_exchange_token=${encodeURIComponent(userToken)}`;

    const exchangeRes = await fetch(exchangeUrl);
    const exchangeData = await exchangeRes.json();

    if (!exchangeRes.ok || !exchangeData.access_token) {
      return NextResponse.json(
        { error: "Token exchange failed", details: exchangeData },
        { status: 502 }
      );
    }

    const longLivedUserToken = exchangeData.access_token as string;
    const userTokenExpiresIn = exchangeData.expires_in as number | undefined;

    // 2. Fetch page tokens via /me/accounts first (long-lived user token → never-expires page tokens)
    const accountsRes = await fetch(
      `https://graph.facebook.com/v25.0/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(longLivedUserToken)}`
    );
    const accountsData = (await accountsRes.json()) as AccountsResponse | { error?: unknown };

    const accountPages = (accountsRes.ok && "data" in accountsData && accountsData.data)
      ? accountsData.data
      : [];

    // 3. For each target page, get a never-expires page token
    const results: Array<{
      page_id: string;
      page_name?: string;
      page_token: string;
      source: string;
      debug_info: unknown;
      persisted: string[];
    }> = [];
    const errors: Array<{ page_id: string; error: string; details?: unknown }> = [];

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    for (const pid of targetPageIds) {
      let pageToken: string | null = null;
      let pageName: string | undefined;
      let source = "";

      // Try /me/accounts first
      const match = accountPages.find((p) => p.id === pid);
      if (match) {
        pageToken = match.access_token;
        pageName = match.name;
        source = "/me/accounts";
      } else {
        // Fallback: query the page directly with long-lived user token
        // This works for pages where user has a role but /me/accounts doesn't list them
        const directRes = await fetch(
          `https://graph.facebook.com/v25.0/${pid}?fields=access_token,name&access_token=${encodeURIComponent(longLivedUserToken)}`
        );
        const directData = await directRes.json();

        if (directRes.ok && directData.access_token) {
          pageToken = directData.access_token;
          pageName = directData.name;
          source = `direct /${pid}?fields=access_token`;
        } else {
          errors.push({ page_id: pid, error: "Could not get page token", details: directData });
          continue;
        }
      }

      // Verify page token via debug_token
      const debugRes = await fetch(
        `https://graph.facebook.com/v25.0/debug_token?input_token=${encodeURIComponent(pageToken)}&access_token=${encodeURIComponent(appId)}|${encodeURIComponent(appSecret)}`
      );
      const debugData = await debugRes.json();

      // Persist to Supabase
      const persistResults: string[] = [];
      try {
        const { data: pageRow } = await supabase
          .from("business_pages")
          .select("business_id")
          .eq("page_id", pid)
          .maybeSingle();

        const businessId = pageRow?.business_id;

        const neverExpires = debugData?.data?.expires_at === 0;

        const { error: pageErr } = await supabase
          .from("business_pages")
          .update({
            access_token: pageToken,
            token_status: "valid",
            token_expires_at: neverExpires ? null : debugData?.data?.expires_at
              ? new Date(debugData.data.expires_at * 1000).toISOString()
              : null,
            updated_at: new Date().toISOString(),
          })
          .eq("page_id", pid);

        if (pageErr) {
          persistResults.push(`business_pages update failed: ${pageErr.message}`);
        } else {
          persistResults.push("business_pages updated");
        }

        if (businessId) {
          const expiresAt = userTokenExpiresIn
            ? new Date(Date.now() + userTokenExpiresIn * 1000).toISOString()
            : null;

          const { error: bizErr } = await supabase
            .from("businesses")
            .update({
              meta_user_token: longLivedUserToken,
              meta_token_expires_at: expiresAt,
              updated_at: new Date().toISOString(),
            })
            .eq("id", businessId);

          if (bizErr) {
            persistResults.push(`businesses update failed: ${bizErr.message}`);
          } else {
            persistResults.push("businesses updated with long-lived user token");
          }
        }
      } catch (persistError) {
        persistResults.push(`persist error: ${String(persistError)}`);
      }

      results.push({
        page_id: pid,
        page_name: pageName,
        page_token: pageToken,
        source,
        debug_info: debugData?.data || null,
        persisted: persistResults,
      });
    }

    return NextResponse.json({
      ok: true,
      long_lived_user_token_expires_in_seconds: userTokenExpiresIn ?? null,
      pages: results,
      errors: errors.length ? errors : undefined,
      available_in_me_accounts: accountPages.map((p) => ({ id: p.id, name: p.name })),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!auth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    usage: "POST with JSON body { userToken: 'short-lived user token' } and Bearer CRON_SECRET",
  });
}
