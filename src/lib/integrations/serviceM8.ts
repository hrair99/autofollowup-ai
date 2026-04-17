// ============================================
// ServiceM8 integration — STUB
//
// Cleanly stubbed so the escalation/human-handoff path can call into it
// without needing real credentials. When SERVICEM8_API_KEY is set, wire
// up real calls here. Until then, every call is a no-op that returns
// { ok: true, stub: true } so the rest of the pipeline stays honest.
// ============================================

export interface ServiceM8LeadPayload {
  commentId: string;
  pageId: string;
  senderId: string | null;
  senderName?: string | null;
  text: string;
  intent: string;
  urgency: string;
  summary: string;
  suggestedReply?: string;
}

export interface ServiceM8Result {
  ok: boolean;
  stub: boolean;
  externalId?: string;
  reason?: string;
}

export function isServiceM8Configured(): boolean {
  return !!process.env.SERVICEM8_API_KEY;
}

export async function pushLeadToServiceM8(
  payload: ServiceM8LeadPayload
): Promise<ServiceM8Result> {
  if (!isServiceM8Configured()) {
    console.log(
      `[ServiceM8 stub] would push lead for comment ${payload.commentId} intent=${payload.intent}`
    );
    return { ok: true, stub: true, reason: "not_configured" };
  }

  // TODO: implement real ServiceM8 Jobs API call here.
  // const res = await fetch("https://api.servicem8.com/api_1.0/job.json", { ... })
  console.warn(
    "[ServiceM8] SERVICEM8_API_KEY is set but real integration is not implemented yet."
  );
  return { ok: false, stub: true, reason: "real_integration_not_implemented" };
}