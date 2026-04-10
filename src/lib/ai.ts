import type { Lead, Settings, Message } from "./types";

// ============================================
// Google Gemini AI layer for smart replies
// ============================================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/**
 * Generate a contextual reply to an incoming Messenger message using Gemini.
 * Falls back to a simple acknowledgment if no API key is configured.
 */
export async function generateMessengerReply(
  lead: Lead,
  settings: Settings,
  incomingMessage: string,
  conversationHistory: Message[] = []
): Promise<string> {
  // If no API key, use a simple fallback
  if (!GEMINI_API_KEY) {
    console.warn("No GEMINI_API_KEY set â using fallback reply");
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

    const systemInstruction = `You are a helpful, ${tone} customer service assistant for ${businessName}.${
      businessDesc ? ` The business ${businessDesc}.` : ""
    }

BUSINESS INFO â HR AIR:
- HVAC / Air Conditioning company based in Australia
- Services include: air conditioning installation, repairs, maintenance & servicing, split systems, ducted systems, multi-head units, and general HVAC work
- Contact email: harrison@hrair.com.au
- Contact phone: 0431 703 913
- Online booking/enquiry link: https://book.servicem8.com/request_service_online_booking?strVendorUUID=2eec0c0d-dbd4-4b52-aaf6-22f38ff2175b#5990b36a-64bd-4aa9-9e5b-23f620791f6b

Your job is to respond to incoming Facebook Messenger messages from potential leads/customers.

Guidelines:
- Be ${tone} and conversational â this is Messenger, not email
- Keep replies concise (2-4 sentences max) â people expect quick, short messages on Messenger
- Answer common HVAC/air conditioning questions helpfully (e.g. maintenance tips, when to service, what type of system suits their needs, general pricing guidance)
- When customers want to book a job, get a quote, or make an enquiry, share the online booking link above
- If they want to speak to someone directly, share the phone number and/or email
- If they ask something very specific you don't know (exact pricing, availability, technical specs), be honest and direct them to call, email, or use the booking link
- Try to move the conversation toward booking an enquiry when appropriate, but don't be pushy
- Use the customer's first name naturally
- Don't use formal email sign-offs â this is a chat
- Never make up specific pricing, availability dates, or technical claims you're unsure about
- If this is the first message from a new lead, welcome them warmly and let them know you can help with any air conditioning questions`;

    const userPrompt = `${
      historyContext
        ? `Previous conversation:\n${historyContext}\n\n`
        : ""
    }New message from ${leadName}: "${incomingMessage}"

Reply as the business assistant:`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemInstruction }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: userPrompt }],
            },
          ],
          generationConfig: {
            maxOutputTokens: 300,
            temperature: 0.7,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", response.status, errorText);
      return getFallbackReply(lead, settings, incomingMessage);
    }

    const data = await response.json();
    const reply =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      getFallbackReply(lead, settings, incomingMessage);

    return reply.trim();
  } catch (error) {
    console.error("Error calling Gemini API:", error);
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
 * Legacy function â kept for compatibility with email follow-ups.
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
      `Hey ${name}! ð\n\nJust bumping this to the top of your inbox. I'd love to chat about how ${business} can help you out.\n\nGot a few minutes this week?\n\n${signature}`,
    ],
    casual: [
      `Hey ${name},\n\nQuick follow-up! Would love to chat when you get a chance.\n\n${signature}`,
    ],
    urgent: [
      `Hi ${name},\n\nI wanted to reach out one more time. We have limited availability this month and I'd hate for you to miss out.\n\nCan we connect today or tomorrow?\n\n${signature}`,
    ],
  };

  const body = (templates[tone] || templates.professional)[0];
  const subject = `Following up â ${business}`;

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
