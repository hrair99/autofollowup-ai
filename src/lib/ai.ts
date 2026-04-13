// ============================================
// AI Layer — Backward compatibility re-exports
// The real implementation is in ./ai/ directory
// ============================================

export { generateConstrainedReply as generateMessengerReply } from "./ai/reply";
export { generateMessengerFollowUp as generateFollowUp } from "./ai/reply";
export { classifyMessage } from "./ai/classify";
export { groqChat, groqJson } from "./ai/groq-client";

// Legacy function kept for email compose UI
export async function generateInitialOutreach(
  lead: { name: string; company: string | null },
  settings: { business_name: string | null; business_description: string | null; signature: string | null }
): Promise<{ subject: string; body: string }> {
  const name = lead.name.split(" ")[0];
  const business = settings.business_name || "our company";
  const desc = settings.business_description || "help businesses like yours grow";

  const subject = `${name}, quick question about ${lead.company || "your business"}`;
  const body = `Hi ${name},\n\nI came across ${lead.company || "your profile"} and thought ${business} might be able to help. We ${desc}.\n\nWould you be open to a quick 15-minute call this week?\n\nBest,\n${settings.signature || business}`;

  return { subject, body };
}
