// ============================================
// Config API — GET/PATCH /api/config
// Reads and writes business_configs (new key/value config system).
// Used by settings UI for handoff, scoring weights, and other
// per-business configuration that lives in business_configs table.
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getUserBusinessId } from "@/lib/business/resolve";
import {
  getBusinessConfig,
  setBusinessConfigBatch,
  clearConfigCache,
} from "@/lib/business/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — return the full typed config for the authenticated user's business
export async function GET() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = await getUserBusinessId(user.id);
  if (!businessId) {
    return NextResponse.json({ error: "No business found" }, { status: 404 });
  }

  const config = await getBusinessConfig(businessId);
  return NextResponse.json({ config });
}

// PATCH — update one or more config keys
// Body: { updates: Record<string, unknown> }
// Keys use dot-notation, e.g. "handoff.auto_expire_hours" -> 48
export async function PATCH(req: NextRequest) {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = await getUserBusinessId(user.id);
  if (!businessId) {
    return NextResponse.json({ error: "No business found" }, { status: 404 });
  }

  const body = await req.json();
  const { updates } = body;

  if (!updates || typeof updates !== "object" || Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "updates object required" }, { status: 400 });
  }

  // Validate allowed config keys (whitelist)
  const ALLOWED_PREFIXES = [
    "handoff.",
    "scoring.",
    "ai.",
    "reply.",
    "followup.",
    "comment.",
    "rate_limits.",
    "service.",
    "business.",
  ];

  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (ALLOWED_PREFIXES.some((p) => key.startsWith(p))) {
      filtered[key] = value;
    }
  }

  if (Object.keys(filtered).length === 0) {
    return NextResponse.json({ error: "No valid config keys" }, { status: 400 });
  }

  await setBusinessConfigBatch(businessId, filtered);
  clearConfigCache(businessId);

  return NextResponse.json({
    success: true,
    updated: Object.keys(filtered),
  });
}
