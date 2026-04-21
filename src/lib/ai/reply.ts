// ============================================
// AI Reply Generation — Constrained by business config + conversation state
// ============================================

import { groqChat } from "./groq-client";
import type {
  Lead,
  Settings,
  Message,
  AiClassification,
  NextAction,
  FaqEntry,
  QualificationData,
} from "../types";

interface ReplyContext {
  lead: Lead;
  settings: Settings;
  incomingMessage: string;
  classification: AiClassification;
  recentMessages: Message[];
  nextAction: NextAction;
  faqEntries: FaqEntry[];
  shouldIncludeEnquiryLink: boolean;
}

/**
 * Generate a constrained AI reply based on the conversation engine's decision.
 */
export async function generateConstrainedReply(ctx: ReplyContext): Promise<string> {
  const systemPrompt = buildSystemPrompt(ctx);
  const userPrompt = buildUserPrompt(ctx);

  const reply = await groqChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { maxTokens: 250, temperature: 0.6 }
  );

  if (reply) return reply;

  // Fallback if AI fails
  return buildFallbackReply(ctx);
}

function buildSystemPrompt(ctx: ReplyContext): string {
  const { settings, nextAction } = ctx;
  const biz = settings.business_name || "our business";
  const tone = settings.ai_tone || "friendly";

  // ── Core identity ──
  let systemPrompt = `You are a professional representative of ${biz}.`;

  if (settings.service_type) {
    systemPrompt += ` The business provides ${settings.service_type} services.`;
  }
  if (settings.business_description) {
    systemPrompt += ` ${settings.business_description}`;
  }

  // ── Communication style ──
  systemPrompt += `\n\nCOMMUNICATION STYLE:
- Tone: ${tone} but professional. Confident, not pushy. Helpful, not salesy.
- Sound like a competent business owner who is busy — not a chatbot.
- Be clear, direct, and helpful. Keep responses concise.
- Use natural, confident language. Not robotic, not overly casual.
- Do NOT use slang, emojis, or filler phrases.
- Do NOT guess or assume details you do not have.
- Do NOT overpromise availability or pricing.
- Always guide the conversation toward the next step.`;

  // ── Response structure ──
  systemPrompt += `\n\nRESPONSE STRUCTURE:
Every reply follows this pattern:
1. Acknowledge the message
2. Provide the relevant info (if needed)
3. Ask one clear next-step question OR provide a clear action
Keep to 1-3 sentences. No long explanations unless asked.`;

  // ── Hard rules ──
  systemPrompt += `\n\nHARD RULES:
- NEVER say "should be fine", "probably", or "I think"
- NEVER give rough pricing unless the business has configured it
- NEVER promise timeframes unless configured
- NEVER use emojis in professional mode
- NEVER use bullet points or numbered lists
- NEVER use formal email-style greetings or sign-offs
- NEVER make up specific prices, availability dates, or technical specs
- When you do not know something specific, direct them to call/email or use the enquiry form
- Do not ramble — answer directly then move the conversation forward
- Use the customer's first name naturally

BOOKING LINK RULE:
- When the action is to send the booking/enquiry link, switch to HANDOFF MODE.
- In handoff mode: do NOT ask for any details the form already collects (location, job type, timing, system details, contact info).
- Keep the message to 1-2 sentences. Just direct them to the form and let them know we'll handle the rest.`;

  // ── Business knowledge ──
  systemPrompt += `\n\nBUSINESS INFORMATION:`;
  if (settings.contact_email) systemPrompt += `\n- Email: ${settings.contact_email}`;
  if (settings.contact_phone) systemPrompt += `\n- Phone: ${settings.contact_phone}`;
  if (settings.callout_fee) systemPrompt += `\n- Call-out fee: ${settings.callout_fee}`;
  if (settings.quote_policy) systemPrompt += `\n- Quote policy: ${settings.quote_policy}`;
  if (settings.service_areas?.length > 0) {
    systemPrompt += `\n- Service areas: ${settings.service_areas.join(", ")}`;
  }
  if (settings.service_categories?.length > 0) {
    systemPrompt += `\n- Services offered: ${settings.service_categories.join(", ")}`;
  }
  if (settings.emergency_available) systemPrompt += `\n- Emergency/after-hours service is available`;
  if (settings.operating_hours) systemPrompt += `\n- Operating hours: ${settings.operating_hours}`;

  // Enquiry form link
  if (settings.enquiry_form_url) {
    systemPrompt += `\n- Online enquiry/booking form: ${settings.enquiry_form_url}`;
  }

  // ── FAQ knowledge ──
  if (ctx.faqEntries.length > 0) {
    systemPrompt += `\n\nFAQ ANSWERS (use these when relevant):`;
    for (const faq of ctx.faqEntries) {
      systemPrompt += `\nQ: ${faq.question}\nA: ${faq.answer}`;
    }
  }

  // ── Action constraints ──
  systemPrompt += `\n\nYOUR NEXT ACTION: ${formatActionInstruction(nextAction, ctx)}`;

  // ── Custom instructions ──
  if (settings.ai_style_instructions) {
    systemPrompt += `\n\nADDITIONAL INSTRUCTIONS FROM THE BUSINESS OWNER:\n${settings.ai_style_instructions}`;
  }

  return systemPrompt;
}

function formatActionInstruction(action: NextAction, ctx: ReplyContext): string {
  const link = ctx.settings.enquiry_form_url;
  const svcType = ctx.settings.service_type || "service";

  switch (action) {
    case "welcome_new":
      return `Acknowledge their message. Let them know you can help with their ${svcType} needs. Ask one clear question about what they need.`;
    case "answer_question":
      return "Answer their question using the business information provided. Be direct. Then ask one clear next-step question to move the conversation forward.";
    case "ask_location":
      return "Ask what suburb or area they are in. One question, direct. E.g. 'What suburb are you in?'";
    case "ask_job_type":
      return "Ask what type of job they need. One question, direct. E.g. 'Is this a repair, service, or new install?'";
    case "ask_urgency":
      return "Ask when they need it done. One question, direct. E.g. 'When were you looking to get this done?'";
    case "ask_details":
      return "Ask for the key missing detail about their job. One specific question only.";
    case "send_enquiry_link":
      return link
        ? `BOOKING LINK HANDOFF MODE — strict rules:
- Include this EXACT link: ${link}
- Keep the entire reply to 1-2 sentences MAX.
- Do NOT ask any qualifying questions (the form collects all details).
- Do NOT ask about location, job type, timing, urgency, or system type.
- Do NOT repeat questions the booking form already handles.
- Simply acknowledge their enquiry, then direct them to complete the form.
- Example tone: "Thanks for your enquiry. You can book in and add all the details here, and we'll take care of the rest: ${link}"`
        : "Direct them to call or email to get the job booked. Keep it to 1-2 sentences. Do NOT ask qualifying questions.";
    case "follow_up_soft":
      return `Check in on their enquiry. Reference what they asked about. ${link ? `Include the booking link: ${link}. Do NOT ask qualifying questions — just direct them to the form.` : ""} Keep it to 1-2 sentences.`;
    case "follow_up_last_attempt":
      return `Final follow-up. Let them know you are available when they are ready. ${link ? `Include the booking link: ${link}. Do NOT ask qualifying questions.` : ""} Keep it to 1-2 sentences.`;
    case "escalate_to_human":
      return "Let them know someone from the team will follow up personally. Be direct and reassuring.";
    case "close_out":
      return "Thank them. Let them know they can reach out anytime.";
    case "reply_to_comment":
      return link
        ? `Reply to their comment. 1-2 lines max. Direct them to DM or the form: ${link}`
        : "Reply to their comment briefly. Ask them to send a DM for details.";
    case "prompt_to_message":
      return "Ask them to send the page a direct message so you can help them properly.";
    default:
      return "Reply helpfully. Move the conversation toward booking. One clear next step.";
  }
}

function buildUserPrompt(ctx: ReplyContext): string {
  const { lead, incomingMessage, recentMessages, classification } = ctx;
  const leadName = lead.name.split(" ")[0];

  let prompt = "";

  // Conversation history
  if (recentMessages.length > 0) {
    const history = recentMessages
      .slice(-8)
      .map((m) => `${m.direction === "inbound" ? leadName : "You"}: ${m.body}`)
      .join("\n");
    prompt += `Previous conversation:\n${history}\n\n`;
  }

  // Lead context
  const qualData = lead.qualification_data || {};
  const knownInfo: string[] = [];
  if (qualData.location) knownInfo.push(`Location: ${qualData.location}`);
  if (qualData.job_type) knownInfo.push(`Job type: ${qualData.job_type}`);
  if (qualData.appliance_type) knownInfo.push(`System: ${qualData.appliance_type}`);
  if (qualData.urgency) knownInfo.push(`Urgency: ${qualData.urgency}`);
  if (knownInfo.length > 0) {
    prompt += `Known info about this lead: ${knownInfo.join(", ")}\n`;
  }
  prompt += `Lead conversion stage: ${lead.conversion_stage}\n`;
  prompt += `Message intent: ${classification.intent}\n\n`;

  prompt += `New message from ${leadName}: "${incomingMessage}"\n\nReply as the business assistant:`;

  return prompt;
}

/**
 * Fallback reply when AI is completely unavailable.
 */
function buildFallbackReply(ctx: ReplyContext): string {
  const { lead, settings, nextAction } = ctx;
  const name = lead.name.split(" ")[0];
  const biz = settings.business_name || "us";
  const link = settings.enquiry_form_url;

  switch (nextAction) {
    case "welcome_new":
      return `Hey ${name}! Thanks for reaching out to ${biz}. How can we help you today?`;
    case "send_enquiry_link":
      return link
        ? `Hi ${name} — thanks for your enquiry. You can book in and add all the details here, and we'll take care of the rest: ${link}`
        : `Hey ${name}, give us a call or send an email and we'll get this sorted for you.`;
    case "ask_location":
      return `No worries ${name}! What suburb are you in?`;
    case "ask_job_type":
      return `Sure thing ${name}! Is this for a repair, service, or new install?`;
    case "escalate_to_human":
      return `Thanks ${name}, I'll get someone from the team to follow up with you personally.`;
    default:
      return `Thanks ${name}! We got your message and we'll get back to you shortly. In the meantime, you can reach us at ${settings.contact_phone || settings.contact_email || biz}.`;
  }
}

/**
 * Generate a comment reply for Facebook post engagement.
 */
export async function generateCommentReply(
  commentText: string,
  settings: Settings
): Promise<string> {
  const biz = settings.business_name || "us";
  const link = settings.enquiry_form_url;

  // Check for custom templates first
  if (settings.comment_reply_templates?.length > 0) {
    const template = settings.comment_reply_templates[
      Math.floor(Math.random() * settings.comment_reply_templates.length)
    ];
    return template
      .replace("{link}", link || "")
      .replace("{business}", biz);
  }

  const tone = settings.ai_tone || "friendly";
  const systemPrompt = `You are a professional representative of ${biz}. Reply to a Facebook comment from a potential customer.

Rules:
- 1-2 lines max. No details in public comments.
- Acknowledge their interest, invite them to DM the page or use the booking form.
- Sound like a competent business owner — not a chatbot.
- Be ${tone} but professional. Confident, not pushy.
- Do NOT use emojis, hashtags, slang, or filler phrases.
- Do NOT give pricing or timeframes in public comments.
- Do NOT say "should be fine", "probably", or "I think".${link ? `\n- Enquiry form: ${link}` : ""}`;

  const reply = await groqChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Comment: "${commentText}"\n\nReply:` },
    ],
    { maxTokens: 80, temperature: 0.7 }
  );

  // Fallback
  if (!reply) {
    return link
      ? `Thanks for your interest! Send us a message or pop your details in here: ${link}`
      : `Thanks! Send us a message and we'll help you out.`;
  }

  return reply;
}

/**
 * Generate a context-aware follow-up message for Messenger.
 */
export async function generateMessengerFollowUp(
  lead: Lead,
  settings: Settings,
  recentMessages: Message[],
  attempt: number
): Promise<string> {
  const name = lead.name.split(" ")[0];
  const biz = settings.business_name || "us";
  const link = settings.enquiry_form_url;
  const isLastAttempt = attempt >= (settings.max_follow_ups || 3);

  const systemPrompt = `You are a professional representative of ${biz}. Write a follow-up Messenger message to ${name} who has not replied.${link ? ` Include this booking form link: ${link}` : ""}

Rules:
- 1-2 sentences. Be direct and concise.
- Sound like a busy, competent business owner — not a chatbot.
- Be ${settings.ai_tone || "friendly"} but professional. Confident, not pushy.
- Reference their previous enquiry naturally if possible.
- Do NOT use emojis, slang, or filler phrases.
- Do NOT say "should be fine", "probably", or "I think".
- Do NOT use formal sign-offs or greetings.
- ${isLastAttempt ? "This is the final follow-up. Be polite and let them know they can reach out anytime." : "Guide them toward taking the next step."}`;


  const historyContext = recentMessages
    .slice(-4)
    .map((m) => `${m.direction === "inbound" ? name : "Bot"}: ${m.body}`)
    .join("\n");

  const reply = await groqChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Conversation so far:\n${historyContext}\n\nWrite follow-up #${attempt}:` },
    ],
    { maxTokens: 120, temperature: 0.7 }
  );

  if (reply) return reply;

  // Fallback
  if (isLastAttempt) {
    return `Hey ${name}, just wanted to check in one more time. We're still happy to help whenever you're ready${link ? ` — you can pop your details in here anytime: ${link}` : ""}. No rush!`;
  }

  const qualData = lead.qualification_data || {};
  const jobRef = qualData.job_type || qualData.appliance_type || "aircon";
  return `Hey ${name}, still happy to help with that ${jobRef} enquiry${link ? ` — best way to get it moving is here: ${link}` : ""}. Let me know!`;
}
