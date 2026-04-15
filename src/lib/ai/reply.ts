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

  let systemPrompt = `You are a ${tone} sales assistant for ${biz}.`;

  if (settings.service_type) {
    systemPrompt += ` The business provides ${settings.service_type} services.`;
  }
  if (settings.business_description) {
    systemPrompt += ` ${settings.business_description}`;
  }

  // Business knowledge
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

  // FAQ knowledge
  if (ctx.faqEntries.length > 0) {
    systemPrompt += `\n\nFAQ ANSWERS (use these when relevant):`;
    for (const faq of ctx.faqEntries) {
      systemPrompt += `\nQ: ${faq.question}\nA: ${faq.answer}`;
    }
  }

  // Action constraints
  systemPrompt += `\n\nYOUR NEXT ACTION: ${formatActionInstruction(nextAction, ctx)}`;

  // Style rules
  systemPrompt += `\n\nRULES:
- This is Facebook Messenger — keep replies SHORT (2-4 sentences max)
- Be ${tone}, concise, and natural — like a real person texting
- Use the customer's first name naturally
- NEVER make up specific prices, availability dates, or technical specs
- When you don't know something specific, direct them to call/email or use the enquiry form
- Do not use formal email-style greetings or sign-offs
- Do not use bullet points or numbered lists
- Do not ramble — answer directly then move the conversation forward`;

  if (settings.ai_style_instructions) {
    systemPrompt += `\n- Additional style: ${settings.ai_style_instructions}`;
  }

  return systemPrompt;
}

function formatActionInstruction(action: NextAction, ctx: ReplyContext): string {
  const link = ctx.settings.enquiry_form_url;

  switch (action) {
    case "welcome_new":
      return "Welcome this new lead warmly. Let them know you can help with their air conditioning needs. Ask what they need help with.";
    case "answer_question":
      return "Answer their question using the business information provided. Be helpful and direct. Then ask a relevant follow-up to keep the conversation moving.";
    case "ask_location":
      return "Ask what suburb or area they are in. Be natural about it, e.g. 'What suburb are you in?' or 'Whereabouts are you located?'";
    case "ask_job_type":
      return "Ask what type of job they need — is it a repair, service, or new install? Keep it casual.";
    case "ask_urgency":
      return "Ask how urgent or when they need it done. E.g. 'When were you looking to get this done?' or 'How soon do you need it?'";
    case "ask_details":
      return "Ask for any missing details about their job, like what type of system they have, or more info about the issue.";
    case "send_enquiry_link":
      return link
        ? `It's time to send the enquiry form link. Include this EXACT link in your reply: ${link} — Frame it naturally, like "Best way to get this booked in is through this form: ${link}" or "Pop your details in here and I'll get this sorted: ${link}"`
        : "Direct them to call or email to get their job booked in.";
    case "follow_up_soft":
      return `Send a gentle follow-up checking if they still need help. Reference their previous enquiry. ${link ? `Include the enquiry link: ${link}` : ""}`;
    case "follow_up_last_attempt":
      return `This is the last follow-up attempt. Be friendly but let them know you're still happy to help if they need anything. ${link ? `Include the enquiry link: ${link}` : ""}`;
    case "escalate_to_human":
      return "Let them know a team member will follow up personally. Be reassuring and professional.";
    case "close_out":
      return "Thank them and let them know they can reach out anytime if they need help.";
    case "reply_to_comment":
      return link
        ? `Reply to their comment. Keep it brief and friendly. Direct them to message the page or use the form: ${link}`
        : "Reply to their comment briefly and ask them to send a message for more details.";
    case "prompt_to_message":
      return "Prompt them to send the page a direct message so you can help them properly.";
    default:
      return "Reply helpfully and try to move the conversation toward booking.";
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
        ? `Hey ${name}, best way to get this booked in is through this form: ${link}`
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
  const systemPrompt = `You are a ${tone} social media assistant for ${biz}. Reply to a Facebook comment from a potential customer. Keep it very brief (1-2 sentences). Be friendly and encourage them to either message the page directly or use the enquiry form.${link ? ` Enquiry form: ${link}` : ""} Do NOT use hashtags.`;

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

  const systemPrompt = `You are a ${settings.ai_tone || "friendly"} assistant for ${biz}. Write a follow-up Messenger message to ${name} who hasn't replied.${link ? ` Include this booking form link: ${link}` : ""}

Rules:
- Very short (1-2 sentences)
- Reference their previous enquiry if possible
- Be natural, not salesy
- ${isLastAttempt ? "This is the final follow-up — be polite and let them know they can reach out anytime." : "Gently encourage them to take the next step."}
- No formal sign-offs`;

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
