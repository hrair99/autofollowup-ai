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
    entities?: Record<string, string>;
    commenterName?: string;
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
    entities,
    commenterName,
  } = options;

  const voiceTone = tone || profile?.defaultTone || "friendly Australian";
  const areas = serviceAreas?.length ? serviceAreas : profile?.defaultServiceAreas || [];
  const firstName = commenterName?.split(" ")[0];

  // Build rich context about what we know from classification + entities
  const contextParts: string[] = [];
  if (serviceType) contextParts.push(`Service asked about: ${serviceType}`);
  if (entities?.issue_type) contextParts.push(`Specific issue: ${entities.issue_type}`);
  if (entities?.service_type) contextParts.push(`System/service type: ${entities.service_type}`);
  if (entities?.job_type) contextParts.push(`Job type: ${entities.job_type}`);
  if (entities?.property_type) contextParts.push(`Property: ${entities.property_type}`);
  if (entities?.callback_intent) contextParts.push(`They ${entities.callback_intent}`);
  if (location) contextParts.push(`Location: ${location}`);
  if (urgency === "emergency") {
    contextParts.push("URGENT/EMERGENCY — acknowledge this immediately, show empathy, reassure them");
  } else if (urgency === "high") {
    contextParts.push("This is urgent — acknowledge the urgency naturally");
  }
  if (areas.length) {
    contextParts.push(`Service areas: ${areas.join(", ")}`);
  }
  if (profile?.industryLabel) {
    contextParts.push(`Industry: ${profile.industryLabel}`);
  }
  if (profile?.serviceCategories?.length) {
    contextParts.push(`Our services include: ${profile.serviceCategories.slice(0, 6).join(", ")}`);
  }
  const contextBlock = contextParts.length > 0
    ? `\nWhat we know about this comment:\n${contextParts.map((c) => `- ${c}`).join("\n")}\n`
    : "";

  // Banned phrases instruction
  const bannedBlock = profile?.bannedPhrases?.length
    ? `\nNEVER use these phrases: ${profile.bannedPhrases.map((p) => `"${p}"`).join(", ")}\n`
    : "";

  // Build urgency-aware tone instructions
  let urgencyTone = "";
  if (urgency === "emergency") {
    urgencyTone = `\nURGENCY INSTRUCTIONS: This is an emergency. Lead with empathy ("That sounds stressful" / "We know that's not fun"). Reassure them you can help fast. Use "we'll get someone to you" language. Don't be overly casual — match their stress level.`;
  } else if (urgency === "high") {
    urgencyTone = `\nURGENCY INSTRUCTIONS: This is somewhat urgent. Acknowledge it naturally and move to action quickly.`;
  }

  // Classification-specific reply guidance
  const classGuidance: Record<string, string> = {
    pricing_request: "They want pricing. Acknowledge this directly. Don't dodge — say you'd love to help with pricing but need a few details. Invite them to DM.",
    quote_request: "They want a quote. Be enthusiastic about quoting. Tell them to DM details so you can give them an accurate one.",
    booking_request: "They want to book/schedule. Confirm you can help, show eagerness. Direct them to DM or booking link.",
    lead_interest: "They've shown interest in your services. Confirm you offer what they need. Guide them to DM for next steps.",
    support_request: "They have an existing issue or need a fix. Show empathy first, then guide to DM for fast help.",
    complaint: "They're unhappy. DON'T be defensive. Apologise sincerely, take responsibility, ask them to DM so you can make it right. Keep it professional.",
    spam: "This looks like spam. Respond briefly and professionally. Don't engage with the spam content.",
  };
  const guidance = classGuidance[classification] || "Respond helpfully and guide them to DM.";

  const systemPrompt = `You are writing a public Facebook comment reply for ${businessName}${profile?.industryLabel ? ` (${profile.industryLabel})` : ""}.

YOUR GOAL: Write a reply that makes this person feel heard and moves them to DM the page.

VOICE:
- ${voiceTone}
- Australian casual but professional: "Yep", "No worries", "Flick us a message", "We'll sort you out", "No dramas", "We'll get you sorted"
- Sound like a real human who works at this business — NOT a chatbot
- Match the energy of the comment. If they're stressed, be reassuring. If they're casual, be casual.
- NEVER use hashtags, emojis, or corporate jargon
- 1-2 sentences MAXIMUM. Short is better. Real businesses don't write essays in comments.
${firstName ? `- Address them by name if natural: "${firstName}"` : ""}
${urgencyTone}

REPLY STRATEGY:
- ${guidance}
- Reference the SPECIFIC thing they mentioned (the service, issue, or situation) — don't give a generic reply
- End with a clear call-to-action: DM the page${enquiryFormUrl ? ` or use this link: ${enquiryFormUrl}` : ""}
- NEVER promise specific pricing, availability, or timelines
- NEVER mention competitors or other businesses
- NEVER start with "Hi there!" or "Hello!" — too formal. Use "Hey", "Hey ${firstName || "mate"}", or just jump in.

${bannedBlock}
${contextBlock}

EXAMPLES OF GOOD REPLIES (for reference, don't copy exactly):
- "Yep we can definitely help with that! Flick us a DM with your suburb and we'll get a quote sorted."
- "Hey ${firstName || "mate"}! That sounds like something we can sort out — shoot us a message with the details."
- "No worries at all! We do that all the time. Pop us a DM and we'll get you booked in."
- "That's no fun! Send us a message with your address and we'll get someone out to you ASAP."

EXAMPLES OF BAD REPLIES (avoid these):
- "Thank you for your inquiry. We would be happy to assist you." (too corporate)
- "Hi there! We appreciate you reaching out to us." (too formal)
- "We offer a wide range of services..." (too generic/salesy)
- Long replies with multiple sentences explaining your services (too much)`;

  const reply = await groqChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Facebook comment: "${commentText}"\n\nWrite your reply (1-2 sentences, casual Aussie tone):` },
    ],
    { maxTokens: 120, temperature: 0.6 }
  );

  // Clean up any quotes the AI might have wrapped the reply in
  if (reply) {
    let cleaned = reply.replace(/^["']|["']$/g, "").trim();
    // Remove any "Reply:" or "Response:" prefix the AI might add
    cleaned = cleaned.replace(/^(Reply|Response|Comment|Answer):\s*/i, "");
    // Remove emoji that might slip through
    cleaned = cleaned.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "").trim();
    // Safety check: verify no banned phrases slipped through
    if (profile && containsBannedPhrase(cleaned, profile)) {
      console.warn("[PublicReply] AI reply contained banned phrase, falling back to template");
      return null; // Caller should fall back to template
    }
    // Verify length — if AI went too long, truncate to last complete sentence
    if (cleaned.length > 280) {
      const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [cleaned];
      cleaned = sentences.slice(0, 2).join(" ").trim();
    }
    return cleaned;
  }

  return reply;
}

/**
 * Generate an AI-powered DM (private message) that's contextual and smart.
 * Much better than static templates — references the specific issue and asks
 * the right qualifying questions for the industry.
 */
export async function generateAiDmReply(
  commentText: string,
  options: {
    classification: CommentClassification;
    businessName: string;
    commenterName?: string;
    enquiryFormUrl?: string | null;
    tone?: string;
    serviceType?: string;
    serviceAreas?: string[];
    urgency?: string;
    profile?: BusinessProfile;
    entities?: Record<string, string>;
  }
): Promise<string | null> {
  const {
    classification,
    businessName,
    commenterName,
    enquiryFormUrl,
    tone,
    serviceAreas,
    urgency,
    profile,
    entities,
  } = options;

  const voiceTone = tone || profile?.defaultTone || "friendly Australian";
  const firstName = commenterName?.split(" ")[0] || "there";
  const areas = serviceAreas?.length ? serviceAreas : profile?.defaultServiceAreas || [];

  // Build industry-specific qualifying questions
  const qualifyingQuestions = buildQualifyingQuestions(classification, profile, entities);

  // Build context
  const contextParts: string[] = [];
  if (entities?.issue_type) contextParts.push(`Issue: ${entities.issue_type}`);
  if (entities?.service_type) contextParts.push(`Service: ${entities.service_type}`);
  if (entities?.job_type) contextParts.push(`Job: ${entities.job_type}`);
  if (urgency === "emergency") contextParts.push("EMERGENCY — be empathetic and fast");
  if (urgency === "high") contextParts.push("Urgent — acknowledge this");
  const contextBlock = contextParts.length > 0
    ? `\nWhat we know: ${contextParts.join(", ")}\n`
    : "";

  const systemPrompt = `You are writing a private Messenger DM for ${businessName}${profile?.industryLabel ? ` (${profile.industryLabel})` : ""}.

Someone just commented on your Facebook page and you're sliding into their DMs to help.

GOAL: Make them feel looked after and get the info you need to help them (or book them in).

VOICE:
- ${voiceTone}
- Casual but professional. Like texting a friendly tradie.
- Use their first name: "${firstName}"
- Keep it SHORT — this is a DM, not an email. 3-5 lines max.
${urgency === "emergency" ? "- EMERGENCY: Lead with empathy. \"That sounds really stressful\" / \"We know burst pipes are no fun\". Reassure them." : ""}

STRUCTURE:
1. Friendly greeting with their name
2. Reference what they commented about (be specific, not generic)
3. ${urgency === "emergency" ? "Reassure them you can help quickly" : "Ask 2-3 quick qualifying questions to help you quote/book"}
4. ${enquiryFormUrl ? `Include booking/enquiry link: ${enquiryFormUrl}` : "Let them know you'll get back to them fast"}
${contextBlock}

${qualifyingQuestions ? `QUALIFYING QUESTIONS TO ASK (pick 2-3 that are relevant):\n${qualifyingQuestions}\n` : ""}

FORMATTING:
- Use line breaks between greeting and questions
- Questions can be bullet points with dashes (-)
- Keep total length under 400 characters
- Don't sign off with a name or title

NEVER:
- Promise specific pricing or timelines
- Use corporate language ("We appreciate your inquiry")
- Write more than 5 lines
- Use emojis`;

  const reply = await groqChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Their Facebook comment was: "${commentText}"\n\nWrite the DM:` },
    ],
    { maxTokens: 200, temperature: 0.6 }
  );

  if (reply) {
    let cleaned = reply.replace(/^["']|["']$/g, "").trim();
    cleaned = cleaned.replace(/^(DM|Message|Reply):\s*/i, "");
    // Remove emoji
    cleaned = cleaned.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "").trim();
    if (profile && containsBannedPhrase(cleaned, profile)) {
      return null;
    }
    return cleaned;
  }

  return reply;
}

/**
 * Build industry-specific qualifying questions based on what we already know.
 */
function buildQualifyingQuestions(
  classification: CommentClassification,
  profile?: BusinessProfile,
  entities?: Record<string, string>
): string {
  const questions: string[] = [];

  if (profile?.industry === "plumbing") {
    if (!entities?.issue_type) questions.push("- What's the issue? (blocked drain, leak, hot water, etc.)");
    if (!entities?.urgency) questions.push("- How urgent is it? (emergency / can wait a day or two)");
    if (!entities?.location) questions.push("- What suburb are you in?");
    if (!entities?.property_type) questions.push("- Is it a house, unit, or commercial?");
    if (entities?.issue_type === "hot water") {
      questions.push("- What type of hot water system? (electric, gas, solar)");
      questions.push("- How old is it roughly?");
    }
    if (entities?.issue_type === "blocked drain") {
      questions.push("- Which drain is blocked? (kitchen, bathroom, laundry, outside)");
    }
  } else if (profile?.industry === "hvac") {
    if (!entities?.service_type) questions.push("- What type of system? (split, ducted, multi-head)");
    if (!entities?.job_type) questions.push("- Is it a new install, repair, or service?");
    if (!entities?.location) questions.push("- What suburb are you in?");
    if (entities?.job_type === "install") {
      questions.push("- How many rooms/zones?");
      questions.push("- Rough size of the space?");
    }
  } else if (profile?.industry === "electrical") {
    if (!entities?.issue_type) questions.push("- What do you need? (power issue, lights, switchboard, etc.)");
    if (!entities?.urgency) questions.push("- Is it urgent or can it wait?");
    if (!entities?.location) questions.push("- What suburb?");
  } else {
    // Generic qualifying questions
    if (!entities?.location) questions.push("- What suburb are you in?");
    if (classification === "quote_request" || classification === "pricing_request") {
      questions.push("- Can you describe what you need done?");
    }
  }

  return questions.slice(0, 4).join("\n");
}
