// ============================================
// Meta Page Subscription Helper
// POSTs to /{page-id}/subscribed_apps with the required fields so the
// HR AIR page actually sends messages and feed events to the webhook.
// Also supports GET to view current subscriptions.
// Protected by CRON_SECRET.
// ============================================

import { NextResponse } from "next/server";

const SUBSCRIBED_FIELDS = [
  "messages",
  "messaging_postbacks",
  "messaging_optins",
  "message_deliveries",
  "message_reads",
  "feed",
];

function auth(request: Request): boolean {
  const header = request.headers.get("authorization") || "";
  const secret = header.replace(/^Bearer\s+/, "");
  return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
}

function getToken(): string {
  const token = process.env.META_PAGE_TOKEN;
  if (!token) throw new Error("META_PAGE_TOKEN not set");
  return token;
}

async function graphGet(path: string, token: string) {
  const url = `https://graph.facebook.com/v25.0${path}${path.includes("?") ? "&" : "?"}access_token=${token}`;
  const r = await fetch(url);
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function graphPost(path: string, body: Record<string, unknown>, token: string) {
  const url = `https://graph.facebook.com/v25.0${path}?access_token=${token}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

// GET — view current page info + existing subscriptions
export async function GET(request: Request) {
  if (!auth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const token = getToken();

    const me = await graphGet("/me?fields=id,name,category", token);
    if (!me.ok) {
      return NextResponse.json(
        { error: "Failed to identify page — token may be expired", detail: me.data },
        { status: 502 }
      );
    }

    const pageId = me.data.id;
    const subs = await graphGet(`/${pageId}/subscribed_apps`, token);

    return NextResponse.json({
      page: me.data,
      subscribed_apps: subs.data,
      required_fields: SUBSCRIBED_FIELDS,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// POST — subscribe the page to our app with the required fields
export async function POST(request: Request) {
  if (!auth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const token = getToken();

    const me = await graphGet("/me?fields=id,name", token);
    if (!me.ok) {
      return NextResponse.json(
        { error: "Token cannot identify page", detail: me.data },
        { status: 502 }
      );
    }

    const pageId = me.data.id;

    const subscribe = await graphPost(
      `/${pageId}/subscribed_apps`,
      { subscribed_fields: SUBSCRIBED_FIELDS.join(",") },
      token
    );

    const after = await graphGet(`/${pageId}/subscribed_apps`, token);

    return NextResponse.json({
      page: me.data,
      subscribe_result: subscribe.data,
      subscribe_status: subscribe.status,
      after: after.data,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
