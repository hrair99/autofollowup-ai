// ============================================
// Token Refresh Helper
// Takes a short-lived user token, exchanges it for a long-lived user token,
// then fetches the never-expires page token for META_PAGE_ID.
// Protected by CRON_SECRET.
// ============================================

import { NextResponse } from "next/server";

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

  let body: { userToken?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userToken = body.userToken?.trim();
  if (!userToken) {
    return NextResponse.json({ error: "userToken required in body" }, { status: 400 });
  }

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

    // 2. Fetch page tokens via /me/accounts (long-lived user token grants never-expires page tokens)
    const accountsRes = await fetch(
      `https://graph.facebook.com/v25.0/me/accounts?access_token=${encodeURIComponent(longLivedUserToken)}`
    );
    const accountsData = (await accountsRes.json()) as AccountsResponse | { error?: unknown };

    if (!accountsRes.ok || !("data" in accountsData) || !accountsData.data) {
      return NextResponse.json(
        { error: "/me/accounts failed", details: accountsData },
        { status: 502 }
      );
    }

    const match = accountsData.data.find((p) => p.id === pageId);
    if (!match) {
      return NextResponse.json(
        {
          error: `Page ${pageId} not found in /me/accounts`,
          available: accountsData.data.map((p) => ({ id: p.id, name: p.name })),
        },
        { status: 404 }
      );
    }

    const pageToken = match.access_token;

    // 3. Verify page token via debug_token
    const debugRes = await fetch(
      `https://graph.facebook.com/v25.0/debug_token?input_token=${encodeURIComponent(pageToken)}&access_token=${encodeURIComponent(appId)}|${encodeURIComponent(appSecret)}`
    );
    const debugData = await debugRes.json();

    return NextResponse.json({
      ok: true,
      page: { id: pageId, name: match.name },
      page_token: pageToken,
      page_token_info: debugData?.data || null,
      long_lived_user_token_expires_in_seconds: userTokenExpiresIn ?? null,
      next_steps: [
        "Update META_PAGE_TOKEN env var in Vercel with page_token",
        "Redeploy production",
        "POST /api/meta-subscribe with Bearer CRON_SECRET to subscribe feed webhook",
      ],
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
