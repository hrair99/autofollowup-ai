// ============================================
// Comment Classifier — Deterministic rules + AI classification
// Classifies Facebook comments for lead signal detection
// ============================================

import { groqJson } from "./groq-client";
import type { BusinessProfile } from "../business/profiles";
import {
  matchProfileIntent,
  extractProfileEntities,
} from "../business/profiles";

// ============================================
// Types
// ============================================

export type CommentClassification =
  | "lead_interest"
  | "pricing_request"
  | "quote_request"
  | "booking_request"
  | "spam"
  | "complaint"
  | "support_request"
  | "non_lead"
  | "unclear";

export interface CommentClassificationResult {
  classification: CommentClassification;
  confidence: number;
  service_type: string | null;
  location: string | null;
  urgency: string | null;
  is_lead_signal: boolean;
  method: "rules" | "ai" | "rules+ai";
  reasoning: string;
  entities: {
    service_type?: string;
    location?: string;
    urgency?: string;
    job_type?: string;
  };
}

// ============================================
// Deterministic Rules — Fast, high-confidence patterns
// ============================================

interface RuleMatch {
  classification: CommentClassification;
  confidence: number;
  reasoning: string;
}

const STRONG_LEAD_PATTERNS: Array<{
  patterns: RegExp[];
  classification: CommentClassification;
  confidence: number;
  reasoning: string;
}> = [
  // Pricing / Cost (including Aussie informal)
  {
    patterns: [
      /\b(price|pricing|how much|cost|rate|rates|fee|fees|charge|charges)\b/i,
      /^\$?\d+\s*\??$/,  // Just a number with question mark
      /\bwhat('s| is| are| do) (the |your |you )?(price|cost|rate|fee|charge)/i,
      /\bhow much (does|do|would|will|is|for|to)\b/i,
      /\bwhat (does|would|will) (it|that|this) cost/i,
      /\bball\s*park\s*(figure|price|cost)?\b/i,
      /\brough\s*(price|cost|idea|estimate)\b/i,
      /\bgive\s+(us|me)\s+(a\s+)?(price|cost|idea)\b/i,
    ],
    classification: "pricing_request",
    confidence: 0.95,
    reasoning: "Explicit pricing/cost inquiry",
  },
  // Quote
  {
    patterns: [
      /\b(quote|estimate|ballpark)\b/i,
      /\bfree quote\b/i,
      /\bget a quote\b/i,
      /\bquote (me|us|please|pls)\b/i,
      /\bcan (you|I|we) get\s+(a\s+)?(quote|price)/i,
    ],
    classification: "quote_request",
    confidence: 0.95,
    reasoning: "Explicit quote request",
  },
  // Booking / Scheduling (expanded Aussie patterns)
  {
    patterns: [
      /\b(book|booking|schedule|appointment)\b/i,
      /\bcome (out|over|to|round|around)\b/i,
      /\bcan (you|someone|anybody|anyone|a tech|a tradie|a plumber|a sparky) come\b/i,
      /\bavailab(le|ility)\b/i,
      /\bwhen (can|could) (you|someone) (come|get here|make it)\b/i,
      /\bgot\s+(any\s+)?(availability|spots|openings)\b/i,
      /\bfirst available\b/i,
      /\bnext available\b/i,
      /\bcan you (get|send) (someone|a guy|a tech|a plumber|a sparky) (out|over|round)/i,
      /\bsend (someone|a guy|a tech|a plumber|a sparky)\b/i,
    ],
    classification: "booking_request",
    confidence: 0.90,
    reasoning: "Booking or availability request",
  },
  // Direct interest (expanded)
  {
    patterns: [
      /\binterested\b/i,
      /\bi('m| am) interested\b/i,
      /\byes (please|pls|mate|absolutely)\b/i,
      /\bsign me up\b/i,
      /\bcount me in\b/i,
      /\byep\s*(,?\s*(please|interested|keen|i'd like))/i,
      /\bkeen\b/i,
      /\bi('m| am) keen\b/i,
      /\bhow do (i|we) (get|go about|start|sign up|book)/i,
      /\bwhere do (i|we) sign up\b/i,
      /\byes\s*!+\s*$/i,
    ],
    classification: "lead_interest",
    confidence: 0.90,
    reasoning: "Direct expression of interest",
  },
  // DM / Message requests
  {
    patterns: [
      /\b(pm|dm|inbox|message)\s*(me|sent|please|pls)?\b/i,
      /\bsend (me |us )?a? ?(message|dm|pm)\b/i,
      /\bpm('d|ed)?\b/i,
      /\bmessage sent\b/i,
      /\bsent (a )?message\b/i,
      /\binbox(ed)?\b/i,
      /\bcheck (your|ya|ur) (inbox|dm|pm|messages)\b/i,
      /\bjust (dm|message|inbox)(ed|'d)? (you|the page)\b/i,
    ],
    classification: "lead_interest",
    confidence: 0.85,
    reasoning: "Request for DM or notification of message",
  },
  // Service need (much expanded — covers trades generically + specific)
  {
    patterns: [
      /\bneed\s+(a |an )?(aircon|air con|air conditioning|hvac|split|ducted|ac)\b/i,
      /\bneed\s+(a |an )?(repair|service|install|maintenance|quote|plumber|electrician|sparky|tradie)\b/i,
      /\blooking for\s+(a |an )?(good |reliable |local )?(aircon|plumber|electrician|hvac|tradie|sparky)\b/i,
      /\bwant\s+(a |an |to get a )?(new|split|ducted)\b/i,
      /\banyone (recommend|know|suggest).{0,30}(plumber|electrician|aircon|tradie|sparky)/i,
      /\bcan anyone (recommend|suggest)\b/i,
      /\bwho (do you|would you|can you) recommend\b/i,
      /\bknow\s+(a\s+)?(good|reliable|local)\s+(plumber|electrician|tradie|sparky)\b/i,
      /\bgot\s+(a\s+)?(problem|issue|drama)\s+(with|in)\b/i,
    ],
    classification: "lead_interest",
    confidence: 0.90,
    reasoning: "Explicit service need",
  },
  // Spam patterns (expanded)
  {
    patterns: [
      /\b(click here|buy now|free money|crypto|bitcoin|forex|nft)\b/i,
      /\b(earn \$|make money|work from home|mlm|passive income)\b/i,
      /https?:\/\/(?!book\.servicem8|facebook\.com|messenger\.com)/i,
      /\b(check my profile|link in bio|follow me|subscribe)\b/i,
      /\b(I made|I earned)\s+\$\d/i,
      /\b(weight loss|lose \d+ kg|diet pill|supplement)\b/i,
    ],
    classification: "spam",
    confidence: 0.90,
    reasoning: "Spam pattern detected",
  },
  // Complaint (expanded)
  {
    patterns: [
      /\b(terrible|awful|worst|horrible|rip ?off|scam|never again|disgraceful|pathetic)\b/i,
      /\b(waste of|don't bother|stay away|avoid|wouldn't recommend)\b/i,
      /\b(ripped off|been waiting|no one called|didn't show|didn't turn up|stood up|never came)\b/i,
      /\b(useless|hopeless|shocking|appalling)\b/i,
    ],
    classification: "complaint",
    confidence: 0.85,
    reasoning: "Complaint or negative sentiment",
  },
];

const WEAK_LEAD_PATTERNS: Array<{
  patterns: RegExp[];
  classification: CommentClassification;
  confidence: number;
  reasoning: string;
}> = [
  // Soft interest signals
  {
    patterns: [
      /\binfo\b/i,
      /\bmore (info|details|information)\b/i,
      /\btell me more\b/i,
      /\bcan (you|I) (get|have) more (info|details)/i,
      /\bwhat('s| are) (your |the )?(details|info)\b/i,
    ],
    classification: "lead_interest",
    confidence: 0.70,
    reasoning: "Information request — moderate lead signal",
  },
  // Service area questions (strong implicit interest)
  {
    patterns: [
      /\bdo you (service|cover|come to|do work in|go to)\b/i,
      /\bwhat area/i,
      /\b(service|cover)\s+(my |the )?(area|suburb|region|side)\b/i,
      /\bdo you come to\b/i,
      /\bare you (in|near|around|close to)\b/i,
      /\bwhat suburbs?\b/i,
      /\bdo you (work|operate) (in|around|near)\b/i,
    ],
    classification: "lead_interest",
    confidence: 0.78,
    reasoning: "Service area inquiry — implicit buying intent",
  },
  // Support / existing customer (expanded)
  {
    patterns: [
      /\bnot (working|cooling|heating|draining|flushing)\b/i,
      /\b(broken|leaking|noisy|smelly|blocked|clogged)\b/i,
      /\bwarranty\b/i,
      /\bstopped working\b/i,
      /\b(keeps|keep) (tripping|leaking|dripping|breaking|shutting off)\b/i,
      /\bmakes? (a |weird |loud |strange )?(noise|sound)\b/i,
    ],
    classification: "support_request",
    confidence: 0.78,
    reasoning: "Support or repair need",
  },
  // Timing/availability questions (implicit booking intent)
  {
    patterns: [
      /\bopen (on )?(saturday|sunday|weekend|public holiday)/i,
      /\bdo you (work|do) (weekend|saturday|sunday|after hours|evening)/i,
      /\b(after hours|24.?hr|24.?hour|emergency)\s*(service|call)/i,
      /\bhow (long|quick|soon|fast)\b/i,
      /\bwhat('s| is| are) (your |the )?(wait|turnaround|lead) (time|list)/i,
    ],
    classification: "lead_interest",
    confidence: 0.72,
    reasoning: "Timing/availability question — implicit interest",
  },
  // "Do you do X?" questions (service inquiry)
  {
    patterns: [
      /\bdo you (guys |also )?(do|offer|provide|handle|fix|repair|install)\b/i,
      /\bcan you (do|fix|repair|install|help with|handle)\b/i,
      /\bdo you (sell|stock|supply|carry)\b/i,
    ],
    classification: "lead_interest",
    confidence: 0.75,
    reasoning: "Service capability question — pre-purchase signal",
  },
  // Payment/finance questions (buying signal)
  {
    patterns: [
      /\b(payment plan|pay later|afterpay|zip pay|finance|lay.?by)\b/i,
      /\bdo you (take|accept) (cards?|eftpos|credit)/i,
      /\bcan (i|we) pay (in|by)\b/i,
    ],
    classification: "lead_interest",
    confidence: 0.80,
    reasoning: "Payment inquiry — strong buying signal",
  },
];

// Non-lead patterns (high confidence skip)
const NON_LEAD_PATTERNS: RegExp[] = [
  // Pure reactions / engagement
  /^[\s!?.]*$/,  // Empty or just punctuation
  /^(lol|haha|hahaha|nice|great|awesome|love it|beautiful|wow|omg|so good|yay|amazing)+[!\s]*$/i,
  /^[😂👍❤️🔥💯👏🙌💪😍🤩😎🥳🎉✨]+\s*$/,  // Emoji-only
  /^(tag|tagging|@)\s/i,
  /^@\w+[\s,]*(@\w+[\s,]*)*$/,  // Just tagging people
  /^(shared|sharing)\b/i,
  // Social responses that aren't service-related
  /^(good (on|for) (you|them|ya)|well done|congrats|congratulations|happy (birthday|anniversary)|rip|condolences)[!\s]*$/i,
  // Competitor/promo for other businesses
  /\bI (can|could) (do|fix) (it|that|this) for (less|cheaper|half)\b/i,
  // Arguments / off-topic debates
  /^(that's|thats) (not true|wrong|bs|bullshit)\b/i,
];

// Abusive patterns — handle with care, don't auto-reply
const ABUSIVE_PATTERNS: RegExp[] = [
  /\b(f+u+c+k+|sh+i+t+|c+u+n+t+|a+ss+h+o+l+e+|d+i+c+k+h+e+a+d+)\b/i,
  /\b(kill yourself|kys|go die)\b/i,
  /\b(racist|sexist|homo|fag|retard)\b/i,
];

// Competitor/self-promotion patterns
const COMPETITOR_PATTERNS: RegExp[] = [
  /\b(we|our company|my business|our team) (also |can )?do (the same|that|this)/i,
  /\b(try|use|call|contact) @?\w+ instead\b/i,
  /\b(I'm|im|we're|i am) (a |an )?(plumber|electrician|tradie|sparky|hvac tech)\b/i,
  /\bmy (mate|friend|brother|cousin).{0,20}(plumber|electrician|tradie|sparky|business)/i,
  /\bhire\s+my\b/i,
];

// ============================================
// Entity extraction
// ============================================

function extractEntities(
  text: string,
  profile?: BusinessProfile
): CommentClassificationResult["entities"] {
  // If we have a business profile, use profile-driven extraction
  if (profile) {
    const profileEntities = extractProfileEntities(text, profile);
    return {
      service_type: profileEntities.service_type || profileEntities.issue_type || undefined,
      job_type: profileEntities.job_type || undefined,
      urgency: profileEntities.urgency || undefined,
      location: profileEntities.location || undefined,
      // Spread any extra profile-specific fields
      ...profileEntities,
    };
  }

  // Fallback: hardcoded HVAC extraction (legacy compatibility)
  const entities: CommentClassificationResult["entities"] = {};
  const lower = text.toLowerCase();

  if (/\bsplit\s*(system)?/i.test(text)) entities.service_type = "split system";
  else if (/\bducted/i.test(text)) entities.service_type = "ducted system";
  else if (/\bmulti[\s-]?head/i.test(text)) entities.service_type = "multi-head";
  else if (/\b(aircon|air con|air conditioning|ac|hvac)\b/i.test(text)) entities.service_type = "air conditioning";

  if (/\b(install|installation|new)\b/i.test(lower)) entities.job_type = "install";
  else if (/\b(repair|fix|broken|not working)\b/i.test(lower)) entities.job_type = "repair";
  else if (/\b(service|maintenance|clean)\b/i.test(lower)) entities.job_type = "service";

  if (/\b(asap|urgent|emergency|today|right now|immediately)\b/i.test(lower)) {
    entities.urgency = "high";
  } else if (/\b(this week|soon|when available)\b/i.test(lower)) {
    entities.urgency = "normal";
  }

  const locationMatch = text.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(\d{4})\b/);
  if (locationMatch) {
    entities.location = `${locationMatch[1]} ${locationMatch[2]}`;
  }

  return entities;
}

// ============================================
// Rule-based classification
// ============================================

function classifyByRules(text: string, profile?: BusinessProfile): RuleMatch | null {
  const trimmed = text.trim();

  // Skip very short non-lead comments
  if (trimmed.length <= 2) {
    return { classification: "non_lead", confidence: 0.95, reasoning: "Too short to be a lead signal" };
  }

  // Check for abusive content — classify but don't auto-reply
  for (const pattern of ABUSIVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { classification: "non_lead", confidence: 0.98, reasoning: "Abusive content detected — do not engage" };
    }
  }

  // Check for competitor/self-promotion comments
  for (const pattern of COMPETITOR_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { classification: "non_lead", confidence: 0.92, reasoning: "Competitor or self-promotion — ignore" };
    }
  }

  // Check non-lead patterns
  for (const pattern of NON_LEAD_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { classification: "non_lead", confidence: 0.95, reasoning: "Non-lead reaction or tag" };
    }
  }

  // Check profile-specific intents FIRST (industry-aware classification)
  if (profile) {
    const intent = matchProfileIntent(trimmed, profile);
    if (intent) {
      return {
        classification: intent.classification,
        confidence: intent.confidence,
        reasoning: `Profile intent: ${intent.label}`,
      };
    }
  }

  // Check strong lead patterns (generic)
  for (const rule of STRONG_LEAD_PATTERNS) {
    for (const pattern of rule.patterns) {
      if (pattern.test(trimmed)) {
        return {
          classification: rule.classification,
          confidence: rule.confidence,
          reasoning: rule.reasoning,
        };
      }
    }
  }

  // Check weak lead patterns
  for (const rule of WEAK_LEAD_PATTERNS) {
    for (const pattern of rule.patterns) {
      if (pattern.test(trimmed)) {
        return {
          classification: rule.classification,
          confidence: rule.confidence,
          reasoning: rule.reasoning,
        };
      }
    }
  }

  return null; // No rule matched — fall through to AI
}

// ============================================
// AI classification (for ambiguous comments)
// ============================================

function buildClassificationPrompt(businessContext?: {
  businessName?: string;
  businessDescription?: string;
  serviceType?: string;
  serviceCategories?: string[];
  profile?: BusinessProfile;
}): string {
  const profile = businessContext?.profile;
  const bizDesc = businessContext?.businessDescription
    || businessContext?.serviceType
    || profile?.industryLabel
    || "a service business";
  const bizName = businessContext?.businessName || "the business";
  const categories = profile?.serviceCategories?.length
    ? `\nServices offered: ${profile.serviceCategories.join(", ")}`
    : businessContext?.serviceCategories?.length
      ? `\nServices offered: ${businessContext.serviceCategories.join(", ")}`
      : "";

  // Include profile-specific intents as classification hints
  const intentHints = profile?.commonIntents?.length
    ? `\n\nIndustry-specific intents to look for:\n${profile.commonIntents.map((i) => `- "${i.key}": ${i.label}`).join("\n")}`
    : "";

  return `You are an expert comment classifier for ${bizName} (${bizDesc}), an Australian service business Facebook page.${categories}${intentHints}

Your job: determine if a Facebook comment represents a potential customer lead, and if so, what kind.

Return a JSON object:
{
  "classification": one of: "lead_interest", "pricing_request", "quote_request", "booking_request", "spam", "complaint", "support_request", "non_lead", "unclear",
  "confidence": 0.0 to 1.0,
  "is_lead_signal": true/false,
  "service_type": specific service mentioned or null,
  "location": suburb/area/postcode mentioned or null,
  "urgency": "low" | "normal" | "high" | "emergency" or null,
  "reasoning": brief explanation
}

CLASSIFICATION RULES:
- "lead_interest": shows interest, asks about services, mentions a need, asks "do you do X?", "what areas?", "are you available?", payment/finance questions
- "pricing_request": asking about cost/price/fees/rates — "how much", "what's it cost", "ballpark price"
- "quote_request": explicitly asking for a quote or estimate
- "booking_request": wants to book/schedule/have someone come out — "can you come", "available this week", "when can you get here"
- "spam": promotional, crypto, MLM, unrelated links, self-promotion
- "complaint": expressing dissatisfaction with the business specifically
- "support_request": existing customer with an issue — something is broken/leaking/not working. If someone describes a problem (blocked drain, burst pipe, no hot water, AC broken), this IS a lead even if it sounds like support — they need the service.
- "non_lead": social engagement only — emoji reactions, tagging friends, general praise with no service interest, congratulations, off-topic chat, arguments
- "unclear": genuinely can't determine intent

IMPORTANT NUANCES FOR AUSTRALIAN TRADES BUSINESSES:
- "Interested!" or "Keen!" on a post = lead_interest (0.90)
- "Do you come to [suburb]?" = lead_interest (0.80) — they're checking before hiring
- Describing a problem (e.g. "my drain is blocked", "hot water isn't working") = support_request with is_lead_signal: true — they NEED the service
- "Can someone come out?" / "Send someone" = booking_request (0.90)
- Questions about opening hours, weekend availability, after-hours = lead_interest (0.75)
- Tagging a friend with "@name check this out" = non_lead UNLESS they also describe a need
- "How much for..." = pricing_request (0.95)
- Pure emoji responses (👍, ❤️, 🔥) = non_lead (0.95)
- Competitors self-promoting ("I can do it cheaper", "try my mate's business") = non_lead (0.92)
- Abusive/vulgar comments = non_lead (0.98)

A comment that describes a PROBLEM (leak, blockage, broken thing, no power, etc.) is ALWAYS a lead signal because they need the service, even if they don't explicitly ask for help.

Return ONLY valid JSON.`;
}

interface AiCommentResult {
  classification: CommentClassification;
  confidence: number;
  is_lead_signal: boolean;
  service_type: string | null;
  location: string | null;
  urgency: string | null;
  reasoning: string;
}

async function classifyByAi(
  text: string,
  postContext?: string,
  businessContext?: {
    businessName?: string;
    businessDescription?: string;
    serviceType?: string;
    serviceCategories?: string[];
  }
): Promise<AiCommentResult | null> {
  const userPrompt = postContext
    ? `Post context: "${postContext}"\n\nComment to classify: "${text}"`
    : `Comment to classify: "${text}"`;

  const systemPrompt = buildClassificationPrompt(businessContext);

  const result = await groqJson<AiCommentResult>(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { maxTokens: 200, temperature: 0.1 }
  );

  return result;
}

// ============================================
// Main classifier — Rules first, AI fallback
// ============================================

export async function classifyComment(
  commentText: string,
  options?: {
    postContext?: string;
    skipAi?: boolean;
    businessContext?: {
      businessName?: string;
      businessDescription?: string;
      serviceType?: string;
      serviceCategories?: string[];
      profile?: BusinessProfile;
    };
  }
): Promise<CommentClassificationResult> {
  const profile = options?.businessContext?.profile;
  const entities = extractEntities(commentText, profile);

  // Step 1: Try deterministic rules (profile-aware)
  const ruleResult = classifyByRules(commentText, profile);

  if (ruleResult && ruleResult.confidence >= 0.85) {
    // High-confidence rule match — use it directly
    return {
      classification: ruleResult.classification,
      confidence: ruleResult.confidence,
      service_type: entities.service_type || null,
      location: entities.location || null,
      urgency: entities.urgency || null,
      is_lead_signal: isLeadClassification(ruleResult.classification),
      method: "rules",
      reasoning: ruleResult.reasoning,
      entities,
    };
  }

  // Step 2: If rules gave a weak match or nothing, try AI
  if (!options?.skipAi) {
    const aiResult = await classifyByAi(commentText, options?.postContext, options?.businessContext);

    if (aiResult && aiResult.confidence > 0) {
      // If we had a weak rule match, use the higher-confidence one
      if (ruleResult && ruleResult.confidence > aiResult.confidence) {
        return {
          classification: ruleResult.classification,
          confidence: ruleResult.confidence,
          service_type: entities.service_type || aiResult.service_type,
          location: entities.location || aiResult.location,
          urgency: entities.urgency || aiResult.urgency,
          is_lead_signal: isLeadClassification(ruleResult.classification),
          method: "rules+ai",
          reasoning: ruleResult.reasoning,
          entities,
        };
      }

      return {
        classification: aiResult.classification,
        confidence: aiResult.confidence,
        service_type: entities.service_type || aiResult.service_type,
        location: entities.location || aiResult.location,
        urgency: entities.urgency || aiResult.urgency,
        is_lead_signal: aiResult.is_lead_signal || isLeadClassification(aiResult.classification),
        method: ruleResult ? "rules+ai" : "ai",
        reasoning: aiResult.reasoning,
        entities,
      };
    }
  }

  // Step 3: Fall back to rule result if AI failed
  if (ruleResult) {
    return {
      classification: ruleResult.classification,
      confidence: ruleResult.confidence,
      service_type: entities.service_type || null,
      location: entities.location || null,
      urgency: entities.urgency || null,
      is_lead_signal: isLeadClassification(ruleResult.classification),
      method: "rules",
      reasoning: ruleResult.reasoning,
      entities,
    };
  }

  // Step 4: No match at all
  return {
    classification: "unclear",
    confidence: 0.2,
    service_type: entities.service_type || null,
    location: entities.location || null,
    urgency: entities.urgency || null,
    is_lead_signal: false,
    method: "rules",
    reasoning: "No matching classification pattern found",
    entities,
  };
}

// ============================================
// Helpers
// ============================================

function isLeadClassification(classification: CommentClassification): boolean {
  return [
    "lead_interest",
    "pricing_request",
    "quote_request",
    "booking_request",
    "support_request",
  ].includes(classification);
}

/**
 * Quick check if a comment text matches any lead keywords.
 * Used for fast filtering before full classification.
 */
export function quickLeadSignalCheck(
  text: string,
  customKeywords?: string[],
  profile?: BusinessProfile
): boolean {
  const lower = text.toLowerCase().trim();

  // Built-in lead signal words (generic, work across all industries)
  const builtInPatterns = [
    /\b(price|pricing|how much|cost|quote|estimate)\b/,
    /\b(interested|interest|need|want|looking for)\b/,
    /\b(pm|dm|message|inbox)\b/,
    /\b(book|booking|available|availability)\b/,
    /\b(can you|how do i|do you)\b/,
    /\b(repair|install|service|maintenance)\b/,
  ];

  if (builtInPatterns.some((p) => p.test(lower))) return true;

  // Profile-specific keywords (industry-aware)
  if (profile?.quickLeadKeywords?.length) {
    if (profile.quickLeadKeywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return true;
    }
  }

  // Custom keywords from settings
  if (customKeywords?.length) {
    return customKeywords.some((kw) => lower.includes(kw.toLowerCase()));
  }

  return false;
}
