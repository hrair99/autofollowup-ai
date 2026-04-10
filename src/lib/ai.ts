import type { Lead, Settings, Message } from "./types";

// ============================================
// Anthropic Claude AI layer for smart replies
// ============================================

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * Generate a contextual reply to an incoming Messenger message using Claude.
 * Falls back to a simple acknowledgment if no API key is configured.
 */
export async function generateMessengerReply(
  lead: Lead,
  settings: Settings,
  incomingMessage: string,
  conversationHistory: Message[] = []
): Promise<string> {
  // If no API key, use a simple fallback
  if (!ANTHROPIC_API_KEY) {
    console.warn("No ANTHROPIC_API_KEY set — using fallback reply");
    return getFallbackReply(lead, settings, incomingMessage);
  }

  try {
    const businessName = settings.business_name || "our business";
    const businessDesc = settings.business_description || "";
    const tone = settings.ai_tone || "friendly";
    const leadName = lead.name.split(" ")[0];

    // Build conversation context from history
    const historyContext = conversationHistory
      .slice(-10) // Last 10 messages for context
      .map(
        (m) =>
          `${m.direction === "inbound" ? leadName : "You"}: ${m.body}`
      )
      .join("\n");

    const systemPrompt = `You are a helpful, ${tone} customer service assistant for ${businessName}.${
      businessDesc ? ` The business ${businessDesc}.` : ""
    }

Your job is to respond to incoming Facebook Messenger messages from potential leads/customers.

Guidelines:
- Be ${tone} and conversational — this is Messenger, not email
- Keep replies concise (2-4 sentences max) — people expect quick, short messages on Messenger
- Answer their questions helpfully and accurately based on what you know about the business
- If they ask something you don't know, be honest and offer to connect them with someone who can help
- Try to move the conversation toward booking a call or meeting when appropriate, but don't be pushy
- Use the customer's first name naturally
- Don't use formal email sign-offs — this is a chat
- Never make up specific details about products, pricing, or services you don't know about
- If this is the first message from a new lead, welcome them warmly`;

    const userPrompt = `${
      historyContext
        ? `Previous conversation:\n${historyContext}\n\n`
        : ""
    }New message from ${leadName}: "${incomingMessage}"

Reply as the business assistant:`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: userPrompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Anthropic API error:", response.status, errorText);
      return getFallbackReply(lead, settings, incomingMessage);
    }

    const data = await response.json();
    const reply =
      data.content?.[0]?.text || getFallbackReply(lead, settings, incomingMessage);

    return reply.trim();
  } catch (error) {
    console.error("Error calling Anthropic API:", error);
    return getFallbackReply(lead, settings, incomingMessage);
  }
}

/**
 * Simple fallback reply when AI is unavailable.
 */
function getFallbackReply(
  lead: Lead,
  settings: Settings,
  _incomingMessage: string
): string {
  const name = lead.name.split(" ")[0];
  const business = settings.business_name || "us";
  return `Hey ${name}! Thanks for reaching out to ${business}. We got your message and someone from our team will get back to you shortly!`;
}

/**
 * Legacy function — kept for compatibility with email follow-ups.
 */
export async function generateFollowUp(
  lead: Lead,
  settings: Settings,
  stepNumber: number,
  _previousMessages: Message[] = []
): Promise<{ subject: string; body: string }> {
  await new Promise((resolve) => setTimeout(resolve, 300));

  const tone = settings.ai_tone || "professional";
  const name = lead.name.split(" ")[0];
  const business = settings.business_name || "our team";
  const signature = settings.signature || business;

  const templates: Record<string, string[]> = {
    professional: [
      `Hi ${name},\n\nI wanted to follow up on my previous message. I believe ${business} could provide significant value to your team.\n\nWould you have 15 minutes this week for a quick call?\n\nBest regards,\n${signature}`,
    ],
    friendly: [
      `Hey ${name}! \n\nJust bumping this to the top of your inbox. I'd love to chat about how ${business} can help you out.\n\nGot a few minutes this week?\n\n${signature}`,
    ],
    casual: [
      `Hey ${name},\n\nQuick follow-up! Would love to chat when you get a chance.\n\n${signature}`,
    ],
    urgent: [
      `Hi ${name},\n\nI wanted to reach out one more time. We have limited availability this month and I'd hate for you to miss out.\n\nCan we connect today or tomorrow?\n\n${signature}`,
    ],
  };

  const body = (templates[tone] || templates.professional)[0];
  const subject = `Following up — ${business}`;

  return { subject, body };
}

export async function generateInitialOutreach(
  lead: Lead,
  settings: Settings
): Promise<{ subject: string; body: string }> {
  await new Promise((resolve) => setTimeout(resolve, 300));

  const name = lead.name.split(" ")[0];
  const business = settings.business_name || "our company";
  const desc = settings.business_description || "help businesses like yours grow";

  const subject = `${name}, quick question about ${lead.company || "your business"}`;
  const body = `Hi ${name},\n\nI came across ${lead.company || "your profile"} and thought ${business} might be able to help. We ${desc}.\n\nWould you be open to a quick 15-minute call this week?\n\nBest,\n${settings.signature || business}`;

  return { subject, body };
}
