// ============================================
// Cron: Expire stale handoffs
// Runs periodically to auto-resume AI on conversations
// where the human didn't respond within the expiry window.
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { expireStaleHandoffs } from "@/lib/conversation/handoff";

export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header =
    req.headers.get("authorization") ||
    req.headers.get("x-cron-secret") ||
    "";
  return header === secret || header === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const expired = await expireStaleHandoffs();

  return NextResponse.json({
    status: "ok",
    expired,
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
