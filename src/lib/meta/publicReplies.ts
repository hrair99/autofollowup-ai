// ============================================
// Public Reply Service — Safe public comment replies
// Used as fallback when Private Reply is unavailable
// ============================================

import { graphApi, getPageToken } from "./client";
import { groqChat } from "../ai/groq-client";
import type { CommentClassification } from "../ai/commentClassifier";

export interface PublicReplyResult {
  success: boolean;
  commentId: string | null;
  error: string | null;
}

/**
 * Post a public reply to a Facebook comment.
 * Uses Graph API: POST /{comment_id}/comments
 */
export async function postPublicReply(
  commentId: string,
  message: string,
  pageId?: string
): Promise<PublicReplyResult> {
  try {
    const token = getPageToken(pageId);
    if (!token) {
      return { success: false, commentId: null, error: "No page token" };
    }

    const result = await graphApi(`/${commentId}/comments`, {
      method: "POST",
      body: { message },
      token,
    }) as { id?: string };

    console.log(`[PublicReply] Replied to ${commentId}: replyId=${result.id}`);

    return {
      success: true,
      commentId: result.id || null,
      error: null,
    };
  } catch (error: unknown) {
    const msg = (error as { data?: { error?: { message?: string } } })?.data?.error?.message || String(error);
    console.error(`[PublicReply] Failed for ${commentId}:`, msg);
    return { success: false, commentId: null, error: msg };
  }
}

/**
 * Like a comment for engagement tracking.
 */
export async function likeComment(commentId: string, pageId?: string): Promise<boolean> {
  try {
    const token = getPageToken(pageId);
    if (!token) return false;

    await graphApi(`/${commentId}/likes`, {
      method: "POST",
      token,
    });

    return true;
  } catch {
    // Non-critical — don't fail on like errors
    return false;
  }
}

// ============================================
// Template-based replies
// ============================================

const DEFAULT_TEMPLATES: Record<string, string[]> = {
  pricing_request: [
    "Thanks for your interest! Best way to get a quote is to send us a message or use our enquiry form{link_suffix}",
    "Hey! Pricing depends on the job — shoot us a DM and we'll sort you out{link_suffix}",
  ],
  quote_request: [
    "We'd love to help! Send us a message with your details and we'll get a quote to you{link_suffix}",
    "Thanks! Pop your details through here and we'll get back to you ASAP{link_suffix}",
  ],
  booking_request: [
    "Awesome! Send us a message or book in through our form and we'll get it sorted{link_suffix}",
    "Thanks! Flick us a DM or use our online booking form{link_suffix}",
  ],
  lead_interest: [
    "Thanks for reaching out! Send us a message and we'll help you out{link_suffix}",
    "Hey! Happy to help — shoot us a DM for more info{link_suffix}",
  ],
  support_request: [
    "Sorry to hear that! Send us a message with the details and we'll get someone onto it{link_suffix}",
    "We'll get this sorted for you — DM us with the details{link_suffix}",
  ],
  default: [
    "Thanks! Send us a message and we'll help you out{link_suffix}",
    "Hey! Flick us a DM and we'll chat{link_suffix}",
  ],
};

/**
 * Pick a template-based public reply.
 */
export function getTemplateReply(
  classification: CommentClassification,
  options: {
    enquiryFormUrl?: string | null;
    customTemplates?: string[];
    businessName?: string;
  }
): string {
  const { enquiryFormUrl, customTemplates, businessName } = options;

  // Use custom templates if available
  if (customTemplates && customTemplates.length > 0) {
    const template = customTemplates[Math.floor(Math.random() * customTemplates.length)];
    return template
      .replace("{link}", enquiryFormUrl || "")
      .replace("{business}", businessName || "us");
  }

  // Pick from defaults
  const templates = DEFAULT_TEMPLATES[classification] || DEFAULT_TEMPLATES.default;
  let reply = templates[Math.floor(Math.random() * templates.length)];

  // Replace link suffix
  const linkSuffix = enquiryFormUrl ? `: ${enquiryFormUrl}` : "";
  reply = reply.replace("{link_suffix}", linkSuffix);

  return reply;
}

/**
 * Generate an AI-powered public reply (for higher quality responses).
 */
export async function generateAiPublicReply(
  commentText: string,
  options: {
    classification: CommentClassification;
    businessName: string;
    enquiryFormUrl?: string | null;
    tone?: string;
  }
): Promise<string | null> {
  const { classification, businessName, enquiryFormUrl, tone } = options;
  const voiceTone = tone || "friendly";

  const systemPrompt = `You are a ${voiceTone} social media assistant for ${businessName} (HVAC/air conditioning company).
Write a short public reply to a Facebook comment from a potential customer.

Rules:
- 1-2 sentences MAX
- Be ${voiceTone} and natural
- Encourage them to send a DM or use the enquiry form
- Do NOT include hashtags
- Do NOT include emojis
- Do NOT mention competitor names
- Do NOT make specific promises about pricing or availability
${enquiryFormUrl ? `- If appropriate, include this enquiry form link: ${enquiryFormUrl}` : "- Direct them to send the page a message"}

The comment was classified as: ${classification}`;

  const reply = await groqChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Comment: "${commentText}"\n\nPublic reply:` },
    ],
    { maxTokens: 80, temperature: 0.7 }
  );

  return reply;
}
