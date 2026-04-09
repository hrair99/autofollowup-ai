import type { Lead, Settings, Message } from "./types";

// ============================================
// Mock AI layer — swap for OpenAI in production
// ============================================

const TEMPLATES: Record<string, string[]> = {
  professional: [
    "Hi {name},\n\nI wanted to follow up on my previous message regarding {company}. I believe we could provide significant value to your team.\n\nWould you have 15 minutes this week for a quick call?\n\nBest regards,\n{signature}",
    "Hello {name},\n\nI hope this message finds you well. I'm reaching out again because I think {business} could be a great fit for {company}.\n\nI'd love to schedule a brief conversation at your convenience.\n\nBest,\n{signature}",
    "Dear {name},\n\nJust circling back on my earlier note. I understand you're busy, but I wanted to make sure this didn't slip through the cracks.\n\nWould any time this week work for a 10-minute chat?\n\nRegards,\n{signature}",
  ],
  friendly: [
    "Hey {name}! 👋\n\nJust bumping this to the top of your inbox. I'd love to chat about how {business} can help {company} grow.\n\nGot a few minutes this week?\n\n{signature}",
    "Hi {name}!\n\nHoping to connect with you — I think there's a real opportunity for us to work together.\n\nLet me know if you'd like to hop on a quick call!\n\nCheers,\n{signature}",
  ],
  casual: [
    "Hey {name},\n\nQuick follow-up! Would love to chat when you get a chance.\n\n{signature}",
    "Hi {name} — just checking in! Let me know if you'd like to connect.\n\n{signature}",
  ],
  urgent: [
    "Hi {name},\n\nI wanted to reach out one more time before I close out your file. We have limited availability this month and I'd hate for {company} to miss out.\n\nCan we connect today or tomorrow?\n\n{signature}",
    "{name},\n\nFinal follow-up — I have a slot open this week that I'm holding for {company}. Let me know if you'd like to grab it.\n\n{signature}",
  ],
};

function fillTemplate(template: string, lead: Lead, settings: Settings): string {
  return template
    .replace(/{name}/g, lead.name.split(" ")[0])
    .replace(/{company}/g, lead.company || "your company")
    .replace(/{business}/g, settings.business_name || "our team")
    .replace(/{signature}/g, settings.signature || settings.business_name || "The Team");
}

export async function generateFollowUp(
  lead: Lead,
  settings: Settings,
  stepNumber: number,
  _previousMessages: Message[] = []
): Promise<{ subject: string; body: string }> {
  // Simulate AI thinking time in demo mode
  await new Promise((resolve) => setTimeout(resolve, 300));

  const tone = settings.ai_tone || "professional";
  const templates = TEMPLATES[tone] || TEMPLATES.professional;
  const template = templates[(stepNumber - 1) % templates.length];
  const body = fillTemplate(template, lead, settings);

  const subjects = [
    `Following up — ${settings.business_name || "Quick question"}`,
    `Re: ${lead.company || lead.name} — next steps?`,
    `Checking in, ${lead.name.split(" ")[0]}`,
    `Don't want you to miss this, ${lead.name.split(" ")[0]}`,
    `Last follow-up — ${settings.business_name || ""}`,
  ];

  const subject = subjects[Math.min(stepNumber - 1, subjects.length - 1)];

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
