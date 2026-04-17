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
  "leadgen",
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

// Resolve Page ID without needing pages_read_engagement.
// Prefers META_PAGE_ID env var; falls back to debug_token inspection; then hardcoded fallback.
async function resolvePageId(token: string): Promise<string | null> {
  if (process.env.META_PAGE_ID) return process.env.META_PAGE_ID;
  const inspect = await graphGet(
    `/debug_token?input_token=${encodeURIComponent(token)}`,
    token
  );
  const id = inspect.data?.data?.profile_id || inspect.data?.data?.user_id;
  if (id) return String(id);
  // Hardcoded fallback for HR AIR page
  return "716051874926664";
}

// GET — view current page info + existing subscriptions
export async function GET(request: Request) {
  if (!auth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const token = getToken();
    const pageId = await resolvePageId(token);
    if (!pageId) {
      return NextResponse.json(
        { error: "Could not resolve page ID. Set META_PAGE_ID env var." },
        { status: 502 }
      );
    }

    const subs = await graphGet(`/${pageId}/subscribed_apps`, token);

    return NextResponse.json({
      page: { id: pageId },
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
    const pageId = await resolvePageId(token);
    if (!pageId) {
      return NextResponse.json(
        { error: "Could not resolve page ID. Set META_PAGE_ID env var." },
        { status: 502 }
      );
    }

    const subscribe = await graphPost(
      `/${pageId}/subscribed_apps`,
      { subscribed_fields: SUBSCRIBED_FIELDS.join(",") },
      token
    );

    const after = await graphGet(`/${pageId}/subscribed_apps`, token);

    return NextResponse.json({
      page: { id: pageId },
      subscribe_result: subscribe.data,
      subscribe_status: subscribe.status,
      after: after.data,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
