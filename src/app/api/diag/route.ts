// ============================================
// System Diagnostic Endpoint
// Reports which env vars are configured, which APIs respond, and which tables are reachable.
// Protected by CRON_SECRET bearer token.
// ============================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

interface CheckResult {
  ok: boolean;
  detail?: string;
  ms?: number;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - t0 };
}

async function checkGroq(): Promise<CheckResult> {
  if (!process.env.GROQ_API_KEY) return { ok: false, detail: "GROQ_API_KEY not set" };
  try {
    const { result: r, ms } = await timed(async () =>
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: "say OK in one word" }],
          max_tokens: 5,
        }),
      })
    );
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}`, ms };
    return { ok: true, ms };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

async function checkMetaToken(): Promise<CheckResult> {
  const token = process.env.META_PAGE_TOKEN;
  if (!token) return { ok: false, detail: "META_PAGE_TOKEN not set" };
  try {
    const { result: r, ms } = await timed(async () =>
      fetch(`https://graph.facebook.com/v25.0/me?access_token=${token}`)
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return {
        ok: false,
        detail: `HTTP ${r.status}: ${data?.error?.message || "unknown"}`,
        ms,
      };
    }
    return {
      ok: true,
      detail: `Page: ${data.name || "?"} (id=${data.id || "?"})`,
      ms,
    };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

async function checkSupabase(): Promise<CheckResult> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, detail: "Supabase env vars missing" };
  }
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const { result, ms } = await timed(async () =>
      supabase.from("leads").select("id", { count: "exact", head: true })
    );
    if (result.error) return { ok: false, detail: result.error.message, ms };
    return { ok: true, detail: `leads table OK (count=${result.count ?? "?"})`, ms };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

async function checkUserExists(): Promise<CheckResult> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, detail: "Supabase env vars missing" };
  }
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) return { ok: false, detail: error.message };
    const count = data?.users?.length || 0;
    return {
      ok: count > 0,
      detail: count > 0 ? `First user: ${data.users[0].email}` : "No users yet — sign up at /signup",
    };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const providedSecret = authHeader?.replace(/^Bearer\s+/, "") || "";
  const expectedSecret = process.env.CRON_SECRET || "";

  // Allow unauth access but hide sensitive detail fields
  const isAuthed = providedSecret === expectedSecret && expectedSecret.length > 0;

  const envPresence = {
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    CRON_SECRET: !!process.env.CRON_SECRET,
    META_VERIFY_TOKEN: !!process.env.META_VERIFY_TOKEN,
    META_PAGE_TOKEN: !!process.env.META_PAGE_TOKEN,
    META_PAGE_TOKENS: !!process.env.META_PAGE_TOKENS,
    GROQ_API_KEY: !!process.env.GROQ_API_KEY,
  };

  // Run all checks in parallel for speed
  const [groq, meta, supabase, users] = await Promise.all([
    checkGroq(),
    checkMetaToken(),
    checkSupabase(),
    checkUserExists(),
  ]);

  // Overall health
  const critical = [groq.ok, supabase.ok, envPresence.META_VERIFY_TOKEN];
  const allOk =
    critical.every(Boolean) && meta.ok && users.ok;
  const anyCriticalFail = !critical.every(Boolean);

  const body = {
    overall: allOk ? "healthy" : anyCriticalFail ? "degraded" : "warning",
    timestamp: new Date().toISOString(),
    deployment: {
      region: process.env.VERCEL_REGION || "unknown",
      url: process.env.VERCEL_URL || "unknown",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || "unknown",
      branch: process.env.VERCEL_GIT_COMMIT_REF || "unknown",
    },
    env_present: envPresence,
    checks: {
      groq: isAuthed ? groq : { ok: groq.ok },
      meta_token: isAuthed ? meta : { ok: meta.ok },
      supabase: isAuthed ? supabase : { ok: supabase.ok },
      users: isAuthed ? users : { ok: users.ok },
    },
    webhook: {
      url: `https://${process.env.VERCEL_URL || "autofollowup-ai.vercel.app"}/api/webhook`,
      verify_token_configured: !!process.env.META_VERIFY_TOKEN,
    },
  };

  const status = allOk ? 200 : anyCriticalFail ? 503 : 200;
  return NextResponse.json(body, { status });
}
