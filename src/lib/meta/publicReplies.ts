// ============================================
// Public Reply Service — Smart public comment replies
// AI-generated with business context and Australian tone
// ============================================

import { graphApi, getPageToken } from "./client";
import { groqChat } from "../ai/groq-client";
import type { CommentClassification } from "../ai/commentClassifier";
import type { BusinessProfile } from "../business/profiles";
import {
  getProfileReplyTemplates,
  containsBannedPhrase,
} from "../business/profiles";

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
  pageId?: string,
  explicitToken?: string
): Promise<PublicReplyResult> {
  try {
    const token = explicitToken || getPageToken(pageId);
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
export async function likeComment(
  commentId: string,
  pageId?: string,
  explicitToken?: string
): Promise<boolean> {
  try {
    const token = explicitToken || getPageToken(pageId);
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
// Template-based replies (Australian tone)
// ============================================

const DEFAULT_TEMPLATES: Record<string, string[]> = {
  pricing_request: [
    "Hey! Pricing depends on the job — flick us a DM with the details and we'll sort you out{link_suffix}",
    "Yep, happy to help with pricing! Best bet is to message us directly so we can give you an accurate quote{link_suffix}",
    "Thanks for reaching out! Drop us a message with what you need and we'll get a quote sorted for you{link_suffix}",
  ],
  quote_request: [
    "We'd love to help! Shoot us a DM with your details and we'll get a quote to you ASAP{link_suffix}",
    "No worries! Pop your details through and we'll get back to you with a quote{link_suffix}",
    "Yep, happy to quote on that! Send us a message with the details{link_suffix}",
  ],
  booking_request: [
    "Awesome! Flick us a message or book in through our form and we'll get it sorted{link_suffix}",
    "No dramas! Send us a DM or use our booking form and we'll lock in a time{link_suffix}",
    "Sounds good! Drop us a message and we'll get you booked in{link_suffix}",
  ],
  lead_interest: [
    "Thanks for reaching out! Shoot us a DM and we'll help you out{link_suffix}",
    "Yep, we can definitely help with that! Send us a message for more info{link_suffix}",
    "No worries! Flick us a DM and we'll sort you out{link_suffix}",
  ],
  support_request: [
    "Sorry to hear that! Send us a message with the details and we'll get someone onto it for you{link_suffix}",
    "No worries, we'll get this sorted! DM us with the details and we'll organise a time{link_suffix}",
    "Thanks for letting us know — drop us a message and we'll take care of it{link_suffix}",
  ],
  complaint: [
    "Sorry to hear that — we take this seriously. Please send us a DM with the details so we can look into it{link_suffix}",
    "That's not the experience we want our customers to have. Please message us directly so we can make it right{link_suffix}",
  ],
  default: [
    "Thanks! Send us a message and we'll help you out{link_suffix}",
    "Yep! Flick us a DM and we'll chat{link_suffix}",
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
    profile?: BusinessProfile;
  }
): string {
  const { enquiryFormUrl, customTemplates, businessName, profile } = options;

  // Use custom templates if available (settings-level override)
  if (customTemplates && customTemplates.length > 0) {
    const template = customTemplates[Math.floor(Math.random() * customTemplates.length)];
    return template
      .replace("{link}", enquiryFormUrl || "")
      .replace("{business}", businessName || "us");
  }

  // Use profile-specific templates if available
  if (profile) {
    const profileTemplates = getProfileReplyTemplates(classification, profile);
    if (profileTemplates.length > 0) {
      const linkSuffix = enquiryFormUrl ? `: ${enquiryFormUrl}` : "";
      let reply = profileTemplates[Math.floor(Math.random() * profileTemplates.length)];
      reply = reply.replace("{link_suffix}", linkSuffix);
      return reply;
    }
  }

  // Pick from defaults (legacy HVAC templates)
  const templates = DEFAULT_TEMPLATES[classification] || DEFAULT_TEMPLATES.default;
  let reply = templates[Math.floor(Math.random() * templates.length)];

  const linkSuffix = enquiryFormUrl ? `: ${enquiryFormUrl}` : "";
  reply = reply.replace("{link_suffix}", linkSuffix);

  return reply;
}

/**
 * Generate an AI-powered public reply with full business context.
 * Uses the business's configured tone, service info, and extracted entities.
 */
export async function generateAiPublicReply(
  commentText: string,
  options: {
    classification: CommentClassification;
    businessName: string;
    enquiryFormUrl?: string | null;
    tone?: string;
    serviceType?: string;
    serviceAreas?: string[];
    location?: string;
    urgency?: string;
    profile?: BusinessProfile;
  }
): Promise<string | null> {
  const {
    classification,
    businessName,
    enquiryFormUrl,
    tone,
    serviceType,
    serviceAreas,
    location,
    urgency,
    profile,
  } = options;

  const voiceTone = tone || profile?.defaultTone || "friendly Australian";
  const areas = serviceAreas?.length ? serviceAreas : profile?.defaultServiceAreas || [];

  // Build context about what we know
  const contextParts: string[] = [];
  if (serviceType) contextParts.push(`They're asking about: ${serviceType}`);
  if (location) contextParts.push(`Location mentioned: ${location}`);
  if (urgency === "high" || urgency === "emergency") {
    contextParts.push("This seems urgent — acknowledge that");
  }
  if (areas.length) {
    contextParts.push(`We service: ${areas.join(", ")}`);
  }
  if (profile?.industryLabel) {
    contextParts.push(`Industry: ${profile.industryLabel}`);
  }
  if (profile?.serviceCategories?.length) {
    contextParts.push(`Services: ${profile.serviceCategories.slice(0, 5).join(", ")}`);
  }
  const contextBlock = contextParts.length > 0
    ? `\nContext:\n${contextParts.map((c) => `- ${c}`).join("\n")}\n`
    : "";

  // Banned phrases instruction
  const bannedBlock = profile?.bannedPhrases?.length
    ? `\nNEVER use these phrases: ${profile.bannedPhrases.map((p) => `"${p}"`).join(", ")}\n`
    : "";

  const systemPrompt = `You are a ${voiceTone} social media assistant for ${businessName}.
Write a short, natural public reply to a Facebook comment.

VOICE & TONE:
- Australian casual-professional: "Yep", "No worries", "Flick us a message", "We'll sort you out"
- Warm and helpful but not over-the-top
- Sound like a real person, not a robot
- Never use hashtags or emojis
- Keep it to 1-2 sentences maximum

RULES:
- Acknowledge what they said specifically (don't be generic)
- Direct them to DM the page or use the enquiry form
- Do NOT promise specific pricing, availability, or timelines
- Do NOT mention competitors
- If the comment mentions a specific service or location, reference it naturally
- If it's urgent, acknowledge the urgency
${enquiryFormUrl ? `- Include this link if natural to do so: ${enquiryFormUrl}` : "- Direct them to send the page a message"}
${bannedBlock}
The comment was classified as: ${classification}
${contextBlock}`;

  const reply = await groqChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Comment: "${commentText}"\n\nYour reply (1-2 sentences, natural tone):` },
    ],
    { maxTokens: 100, temperature: 0.7 }
  );

  // Clean up any quotes the AI might have wrapped the reply in
  if (reply) {
    const cleaned = reply.replace(/^["']|["']$/g, "").trim();
    // Safety check: verify no banned phrases slipped through
    if (profile && containsBannedPhrase(cleaned, profile)) {
      console.warn("[PublicReply] AI reply contained banned phrase, falling back to template");
      return null; // Caller should fall back to template
    }
    return cleaned;
  }

  return reply;
}
