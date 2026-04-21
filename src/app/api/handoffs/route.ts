// ============================================
// Handoff API — GET/POST/PATCH for conversation handoffs
// GET:   list handoffs for the user's business
// POST:  manually create a handoff (human escalation)
// PATCH: claim or resolve a handoff
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getBusinessHandoffs,
  claimHandoff,
  resolveHandoff,
  createHandoff,
} from "@/lib/conversation/handoff";
import { getUserBusinessId } from "@/lib/business/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getAuthUser() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

// GET — list open/claimed handoffs for the user's business
export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = await getUserBusinessId(user.id);
  if (!businessId) {
    return NextResponse.json({ error: "No business found" }, { status: 404 });
  }

  const handoffs = await getBusinessHandoffs(businessId, {
    status: ["open", "claimed"],
    limit: 50,
  });

  return NextResponse.json({ handoffs });
}

// POST — manually create a handoff for a lead
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = await getUserBusinessId(user.id);
  if (!businessId) {
    return NextResponse.json({ error: "No business found" }, { status: 404 });
  }

  const body = await req.json();
  const { leadId, reason, priority } = body;

  if (!leadId) {
    return NextResponse.json({ error: "leadId required" }, { status: 400 });
  }

  const result = await createHandoff({
    businessId,
    leadId,
    trigger: "human",
    reason: reason || "manual_escalation",
    priority: priority || "normal",
  });

  if (!result) {
    return NextResponse.json({ error: "Failed to create handoff" }, { status: 500 });
  }

  return NextResponse.json({ handoffId: result.handoffId });
}

// PATCH — claim or resolve a handoff
export async function PATCH(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { handoffId, action, notes } = body;

  if (!handoffId || !action) {
    return NextResponse.json(
      { error: "handoffId and action required" },
      { status: 400 }
    );
  }

  if (action === "claim") {
    const success = await claimHandoff(handoffId, user.id);
    return NextResponse.json({ success });
  }

  if (action === "resolve") {
    const success = await resolveHandoff(handoffId, user.id, notes);
    return NextResponse.json({ success });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
