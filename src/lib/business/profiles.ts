// ============================================
// Business Profiles — Industry-specific configuration
// Each business has an industry profile that drives:
//   - Comment classification (intents, keywords)
//   - Entity extraction (fields to extract)
//   - Reply generation (templates, tone, banned phrases)
//   - Lead enrichment (field schema)
// ============================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ============================================
// Types
// ============================================

export interface BusinessIntent {
  key: string;           // e.g. "blocked_drain", "split_system_install"
  label: string;         // Human-readable: "Blocked Drain"
  keywords: RegExp[];    // Patterns that trigger this intent
  classification: "lead_interest" | "pricing_request" | "quote_request" | "booking_request" | "support_request";
  confidence: number;    // Default confidence when matched
  urgency?: "low" | "normal" | "high" | "emergency";
}

export interface EntityField {
  key: string;           // e.g. "issue_type", "property_type"
  label: string;         // "Issue Type"
  extractors: Array<{
    pattern: RegExp;
    value: string;
  }>;
}

export interface ReplyExample {
  classification: string;
  templates: string[];
}

export interface LeadFieldSchema {
  key: string;
  label: string;
  type: "text" | "select" | "number";
  options?: string[];   // For select fields
  required?: boolean;
}

export interface BusinessProfile {
  industry: string;                  // "hvac", "plumbing", "electrical"
  industryLabel: string;             // "HVAC / Air Conditioning"
  serviceCategories: string[];       // ["Split Systems", "Ducted", ...]
  commonIntents: BusinessIntent[];
  entityFields: EntityField[];
  replyExamples: ReplyExample[];
  dmTemplates: Record<string, string[]>;
  bannedPhrases: string[];
  defaultServiceAreas: string[];
  defaultTone: string;
  leadFieldSchema: LeadFieldSchema[];
  quickLeadKeywords: string[];       // Extra keywords for quick lead signal check
}

// ============================================
// HVAC / Air Conditioning Profile (HR AIR default)
// ============================================

const HVAC_PROFILE: BusinessProfile = {
  industry: "hvac",
  industryLabel: "HVAC / Air Conditioning",
  serviceCategories: [
    "Split System Installation",
    "Split System Repair",
    "Ducted System Installation",
    "Ducted System Repair",
    "Multi-Head Systems",
    "Air Conditioning Service",
    "Air Conditioning Maintenance",
    "Commercial HVAC",
  ],
  commonIntents: [
    {
      key: "split_install",
      label: "Split System Installation",
      keywords: [
        /\bneed\s+(a |an )?(new )?(split|split\s*system)/i,
        /\b(install|installation)\s+(a |an )?(split|split\s*system)/i,
        /\bwant\s+(a |an )?(new )?(split|split\s*system)/i,
      ],
      classification: "lead_interest",
      confidence: 0.92,
    },
    {
      key: "ducted_install",
      label: "Ducted System Installation",
      keywords: [
        /\bneed\s+(a |an )?(new )?ducted/i,
        /\b(install|installation)\s+(a |an )?ducted/i,
        /\bwant\s+(a |an )?(new )?ducted/i,
      ],
      classification: "lead_interest",
      confidence: 0.92,
    },
    {
      key: "ac_repair",
      label: "AC Repair",
      keywords: [
        /\b(aircon|air con|ac|split|ducted)\s+(not|isn't|isnt)\s+(working|cooling|heating)/i,
        /\b(broken|busted|dead)\s+(aircon|air con|ac|split|ducted)/i,
        /\b(aircon|air con|ac)\s+(repair|fix)/i,
      ],
      classification: "support_request",
      confidence: 0.88,
    },
    {
      key: "ac_service",
      label: "AC Service / Maintenance",
      keywords: [
        /\b(aircon|air con|ac|split|ducted)\s+(service|maintenance|clean)/i,
        /\bservice\s+(my |the )?(aircon|air con|ac|split|ducted)/i,
      ],
      classification: "booking_request",
      confidence: 0.85,
    },
    {
      key: "emergency_ac",
      label: "Emergency AC",
      keywords: [
        /\b(emergency|urgent).{0,20}(aircon|air con|ac|cooling|heating)/i,
        /\b(aircon|air con|ac|cooling|heating).{0,20}(emergency|urgent|asap)/i,
      ],
      classification: "booking_request",
      confidence: 0.95,
      urgency: "emergency",
    },
    {
      key: "general_enquiry",
      label: "General Enquiry",
      keywords: [
        /\bdo you (do|service|install|repair)\b/i,
        /\bwhat (brands?|types?|models?) do you/i,
      ],
      classification: "lead_interest",
      confidence: 0.75,
    },
  ],
  entityFields: [
    {
      key: "service_type",
      label: "System Type",
      extractors: [
        { pattern: /\bsplit\s*(system)?/i, value: "split system" },
        { pattern: /\bducted/i, value: "ducted system" },
        { pattern: /\bmulti[\s-]?head/i, value: "multi-head" },
        { pattern: /\b(aircon|air con|air conditioning|ac|hvac)\b/i, value: "air conditioning" },
      ],
    },
    {
      key: "job_type",
      label: "Job Type",
      extractors: [
        { pattern: /\b(install|installation|new)\b/i, value: "install" },
        { pattern: /\b(repair|fix|broken|not working)\b/i, value: "repair" },
        { pattern: /\b(service|maintenance|clean)\b/i, value: "service" },
      ],
    },
    {
      key: "urgency",
      label: "Urgency",
      extractors: [
        { pattern: /\b(asap|urgent|emergency|today|right now|immediately)\b/i, value: "high" },
        { pattern: /\b(this week|soon|when available)\b/i, value: "normal" },
      ],
    },
    {
      key: "location",
      label: "Location",
      extractors: [
        { pattern: /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(\d{4})\b/, value: "$match" },
      ],
    },
  ],
  replyExamples: [
    {
      classification: "pricing_request",
      templates: [
        "Hey! Pricing depends on the job — flick us a DM with the details and we'll sort you out{link_suffix}",
        "Yep, happy to help with pricing! Best bet is to message us directly so we can give you an accurate quote{link_suffix}",
      ],
    },
    {
      classification: "quote_request",
      templates: [
        "We'd love to help! Shoot us a DM with your details and we'll get a quote to you ASAP{link_suffix}",
        "No worries! Pop your details through and we'll get back to you with a quote{link_suffix}",
      ],
    },
    {
      classification: "booking_request",
      templates: [
        "Awesome! Flick us a message or book in through our form and we'll get it sorted{link_suffix}",
        "No dramas! Send us a DM or use our booking form and we'll lock in a time{link_suffix}",
      ],
    },
    {
      classification: "lead_interest",
      templates: [
        "Thanks for reaching out! Shoot us a DM and we'll help you out{link_suffix}",
        "Yep, we can definitely help with that! Send us a message for more info{link_suffix}",
      ],
    },
    {
      classification: "support_request",
      templates: [
        "Sorry to hear that! Send us a message with the details and we'll get someone onto it for you{link_suffix}",
        "No worries, we'll get this sorted! DM us with the details and we'll organise a time{link_suffix}",
      ],
    },
  ],
  dmTemplates: {
    pricing_request: [
      "Hey {name}! Thanks for your interest. To give you an accurate price, can you tell us:\n\n- What type of system are you after? (split, ducted, multi-head)\n- How many rooms/zones?\n- Suburb?\n\nWe'll get a quote to you ASAP!",
      "Hey {name}! Happy to help with pricing. Every install's a bit different so to get you an accurate number:\n\n- What type of system? (split/ducted)\n- New install or replacing an old one?\n- Your suburb?\n\nWe'll get back to you shortly!",
    ],
    quote_request: [
      "Hey {name}! We'd love to help. A few quick details so we can quote accurately:\n\n- What type of system? (new install or replacement?)\n- Size of the space?\n- Your suburb?\n\nWe'll have a quote sorted for you shortly!",
      "Hey {name}! Yep, happy to quote on that. Can you let us know:\n\n- Split or ducted?\n- How many rooms?\n- Where are you located?\n\nWe'll get numbers to you ASAP!",
    ],
    booking_request: [
      "Hey {name}! Great to hear you'd like to book in. What days/times work best for you? We service most of {service_areas} and can usually get out within a few days.",
      "Hey {name}! We can definitely get you booked in. What suburb are you in and when suits? We'll lock in a time.",
    ],
    support_request: [
      "Hey {name}! Sorry to hear your AC's playing up. To get the right tech out to you:\n\n- What type of system? (split/ducted)\n- What's it doing? (not cooling, making noise, leaking, etc.)\n- Your suburb?\n\nWe'll get someone sorted for you!",
    ],
    lead_interest: [
      "Hey {name}! Thanks for reaching out. We'd love to help — are you looking at a new install or do you need a repair/service? Let us know your suburb and we'll go from there!",
    ],
    default: [
      "Hey {name}! Thanks for reaching out to {business_name}. How can we help you today?",
    ],
  },
  bannedPhrases: [
    "guaranteed lowest price",
    "cheapest in town",
    "beat any quote",
    "competitors",
    "other companies",
  ],
  defaultServiceAreas: ["Gold Coast", "Brisbane South", "Tweed Heads"],
  defaultTone: "friendly Australian casual-professional",
  leadFieldSchema: [
    { key: "system_type", label: "System Type", type: "select", options: ["Split", "Ducted", "Multi-Head", "Other"] },
    { key: "job_type", label: "Job Type", type: "select", options: ["Install", "Repair", "Service", "Quote"] },
    { key: "rooms", label: "Number of Rooms", type: "number" },
    { key: "suburb", label: "Suburb", type: "text", required: true },
    { key: "property_type", label: "Property Type", type: "select", options: ["House", "Apartment", "Townhouse", "Commercial"] },
  ],
  quickLeadKeywords: [
    "aircon", "air con", "air conditioning", "split", "ducted", "hvac",
    "cooling", "heating", "multi-head", "ac unit",
  ],
};

// ============================================
// Plumbing Profile (Rowe Plumbing)
// ============================================

const PLUMBING_PROFILE: BusinessProfile = {
  industry: "plumbing",
  industryLabel: "Plumbing",
  serviceCategories: [
    "Blocked Drains",
    "Leak Detection & Repair",
    "Burst Pipe Repair",
    "Hot Water Systems",
    "Toilet Repairs & Installation",
    "Tap Repairs & Installation",
    "Gas Plumbing",
    "Emergency Plumbing",
    "Bathroom Renovations",
    "General Plumbing",
  ],
  commonIntents: [
    {
      key: "blocked_drain",
      label: "Blocked Drain",
      keywords: [
        /\b(blocked|clogged|slow)\s+(drain|sink|shower|bath|toilet)/i,
        /\bdrain\s+(blocked|clogged|backed up|backing up|slow)/i,
        /\bwater\s+(won't|wont|not)\s+drain/i,
        /\bsewer\s+(smell|backup|blocked)/i,
        /\bstormwater\s+(blocked|backup)/i,
      ],
      classification: "support_request",
      confidence: 0.92,
      urgency: "high",
    },
    {
      key: "leak",
      label: "Leak",
      keywords: [
        /\b(leak|leaking|leaks|drip|dripping)\b/i,
        /\bwater\s+(leak|leaking|coming out|running)/i,
        /\b(ceiling|wall|floor|under)\s+(leak|leaking|dripping|wet)/i,
        /\bfound\s+(a\s+)?leak/i,
      ],
      classification: "support_request",
      confidence: 0.90,
      urgency: "high",
    },
    {
      key: "burst_pipe",
      label: "Burst Pipe",
      keywords: [
        /\b(burst|busted|broken|cracked)\s+pipe/i,
        /\bpipe\s+(burst|busted|broken|cracked|leaking)/i,
        /\bflooding/i,
        /\bwater\s+(everywhere|flooding|gushing|spraying)/i,
      ],
      classification: "booking_request",
      confidence: 0.98,
      urgency: "emergency",
    },
    {
      key: "hot_water_issue",
      label: "Hot Water Issue",
      keywords: [
        /\bhot\s+water\s+(not|isn't|isnt|stopped|no longer|broken|dead)/i,
        /\bno\s+hot\s+water/i,
        /\b(hot water|hwu|hws)\s+(system|unit|heater|service|install|replace)/i,
        /\bcold\s+(shower|water|only)\b/i,
        /\bnew\s+hot\s+water/i,
      ],
      classification: "support_request",
      confidence: 0.92,
      urgency: "high",
    },
    {
      key: "toilet_issue",
      label: "Toilet Issue",
      keywords: [
        /\btoilet\s+(blocked|clogged|running|leaking|broken|overflowing|not flushing)/i,
        /\b(blocked|clogged|broken|leaking|running)\s+toilet/i,
        /\btoilet\s+(install|replace|replacement|new)/i,
        /\bcistern\s+(leak|running|broken)/i,
      ],
      classification: "support_request",
      confidence: 0.90,
    },
    {
      key: "tap_issue",
      label: "Tap Issue",
      keywords: [
        /\btap\s+(leak|leaking|dripping|broken|won't|wont|hard to turn)/i,
        /\b(leaking|dripping|broken)\s+tap/i,
        /\b(new|replace|replacement)\s+tap/i,
        /\bmixer\s+(tap|install|replace)/i,
      ],
      classification: "support_request",
      confidence: 0.88,
    },
    {
      key: "gas_plumbing",
      label: "Gas Plumbing",
      keywords: [
        /\bgas\s+(leak|smell|plumb|fitting|line|connection|install|appliance)/i,
        /\bsmell\s+(of\s+)?gas/i,
        /\bgas\s+(stove|cooktop|oven|heater|bayonet|point)\s+(install|connect)/i,
      ],
      classification: "booking_request",
      confidence: 0.92,
      urgency: "high",
    },
    {
      key: "emergency_callout",
      label: "Emergency Callout",
      keywords: [
        /\b(emergency|urgent|asap|right now|immediately).{0,20}plumb/i,
        /\bplumb.{0,20}(emergency|urgent|asap)/i,
        /\b(flooding|flooded|burst|overflowing)\b/i,
        /\bneed\s+(a\s+)?plumber\s+(now|asap|urgently|today)/i,
      ],
      classification: "booking_request",
      confidence: 0.96,
      urgency: "emergency",
    },
    {
      key: "quote_request",
      label: "Quote Request",
      keywords: [
        /\b(quote|estimate|ballpark|price|pricing|how much)\b.{0,30}plumb/i,
        /\bplumb.{0,30}(quote|estimate|price|cost)/i,
        /\bhow much.{0,20}(to |for ).{0,20}(fix|repair|install|replace)/i,
      ],
      classification: "quote_request",
      confidence: 0.92,
    },
    {
      key: "general_enquiry",
      label: "General Enquiry",
      keywords: [
        /\bdo you (do|service|fix|repair|install)\b/i,
        /\bneed\s+(a\s+)?plumber/i,
        /\blooking\s+for\s+(a\s+)?plumber/i,
        /\bcan you (come|help|fix|repair)\b/i,
      ],
      classification: "lead_interest",
      confidence: 0.80,
    },
  ],
  entityFields: [
    {
      key: "issue_type",
      label: "Issue Type",
      extractors: [
        { pattern: /\b(blocked|clogged)\s+drain/i, value: "blocked drain" },
        { pattern: /\bleak/i, value: "leak" },
        { pattern: /\bburst\s+pipe/i, value: "burst pipe" },
        { pattern: /\bhot\s+water/i, value: "hot water" },
        { pattern: /\btoilet/i, value: "toilet" },
        { pattern: /\btap/i, value: "tap" },
        { pattern: /\bgas/i, value: "gas" },
        { pattern: /\bsewer/i, value: "sewer" },
        { pattern: /\bstormwater/i, value: "stormwater" },
        { pattern: /\bbathroom\s+(reno|renovation)/i, value: "bathroom renovation" },
      ],
    },
    {
      key: "urgency",
      label: "Urgency",
      extractors: [
        { pattern: /\b(emergency|flooding|flooded|burst|gushing|overflowing|gas\s+leak)\b/i, value: "emergency" },
        { pattern: /\b(asap|urgent|today|right now|immediately)\b/i, value: "high" },
        { pattern: /\b(this week|soon|when available)\b/i, value: "normal" },
      ],
    },
    {
      key: "location",
      label: "Suburb / Location",
      extractors: [
        { pattern: /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(\d{4})\b/, value: "$match" },
      ],
    },
    {
      key: "property_type",
      label: "Property Type",
      extractors: [
        { pattern: /\b(house|home|residential)\b/i, value: "residential" },
        { pattern: /\b(apartment|unit|flat)\b/i, value: "apartment" },
        { pattern: /\b(townhouse|town house)\b/i, value: "townhouse" },
        { pattern: /\b(commercial|office|shop|warehouse)\b/i, value: "commercial" },
        { pattern: /\b(rental|investment|tenant)\b/i, value: "rental" },
      ],
    },
    {
      key: "callback_intent",
      label: "Callback Intent",
      extractors: [
        { pattern: /\b(call|ring|phone)\s+(me|us|back)\b/i, value: "wants callback" },
        { pattern: /\b(come|send\s+someone)\s+(out|over|to)\b/i, value: "wants site visit" },
        { pattern: /\b(dm|message|inbox)\b/i, value: "prefers messaging" },
      ],
    },
  ],
  replyExamples: [
    {
      classification: "support_request",
      templates: [
        "No worries! Flick us a DM with the details and we'll get a plumber out to you{link_suffix}",
        "We can definitely help with that! Send us a message with your suburb and we'll get it sorted{link_suffix}",
        "Sounds like something we can fix — shoot us a DM and we'll organise a time{link_suffix}",
        "We deal with this stuff all the time — pop us a message and we'll get it sorted for you{link_suffix}",
      ],
    },
    {
      classification: "pricing_request",
      templates: [
        "Hey! Pricing depends on the job — drop us a DM with the details and we'll give you a proper quote{link_suffix}",
        "Yep, happy to help! Flick us a message with what's going on and we'll sort out pricing{link_suffix}",
        "Good question! Every job's a bit different — send us a DM with the details and we'll get you an accurate price{link_suffix}",
      ],
    },
    {
      classification: "quote_request",
      templates: [
        "We'd love to help! Pop us a DM with the details and we'll get a quote to you{link_suffix}",
        "No worries — shoot us a message with the details and we'll quote it up for you{link_suffix}",
        "Yep! Flick us a DM with what you need and we'll have a quote sorted in no time{link_suffix}",
      ],
    },
    {
      classification: "booking_request",
      templates: [
        "Awesome! Flick us a DM with your suburb and we'll get a plumber out to you ASAP{link_suffix}",
        "No dramas! Send us a message and we'll lock in a time that works{link_suffix}",
        "Yep, we can get someone out to you! Pop us a DM with your suburb and preferred time{link_suffix}",
      ],
    },
    {
      classification: "lead_interest",
      templates: [
        "Thanks for reaching out! Shoot us a DM and we'll help you out{link_suffix}",
        "Yep, we can definitely help with that! Send us a message for more info{link_suffix}",
        "Yep, that's right up our alley! Flick us a DM and we'll sort you out{link_suffix}",
      ],
    },
    {
      classification: "complaint",
      templates: [
        "Sorry to hear that — we take this seriously. Please send us a DM with the details so we can look into it{link_suffix}",
        "That's not the experience we want for our customers. Please message us directly so we can sort it out{link_suffix}",
      ],
    },
  ],
  dmTemplates: {
    support_request: [
      "Hey {name}! Thanks for reaching out. To help us get the right plumber to you quickly, can you let us know:\n\n- What's the issue? (e.g. blocked drain, leaking tap, hot water)\n- How urgent is it? (emergency / can wait a day or two)\n- Your suburb?\n\nWe'll get back to you ASAP!",
      "Hey {name}! We can definitely help with that. A couple of quick questions so we can get the right person to you:\n\n- Can you describe what's happening?\n- Your suburb?\n- Is it a house, unit, or commercial?\n\nWe'll be in touch shortly!",
    ],
    quote_request: [
      "Hey {name}! We'd love to quote on that for you. A few quick details:\n\n- What work do you need done?\n- Your suburb?\n- Is it a house, unit, or commercial?\n\nWe'll get a quote sorted for you shortly!",
      "Hey {name}! Happy to get you a quote. To make sure it's accurate, can you let us know:\n\n- What's the job? (rough description is fine)\n- Where are you located?\n\nWe'll get back to you with numbers ASAP!",
    ],
    booking_request: [
      "Hey {name}! Great to hear you'd like to book in a plumber. What days/times work best? We service most of {service_areas} and can usually get someone out within 24-48 hours.",
      "Hey {name}! We can get someone out to you — what suburb are you in and when suits? We'll lock in a time.",
    ],
    pricing_request: [
      "Hey {name}! Good question on pricing — every job's a bit different so we want to give you an accurate number. Can you let us know:\n\n- What's the job?\n- Your suburb?\n\nWe'll get a price to you quickly!",
    ],
    lead_interest: [
      "Hey {name}! Thanks for your interest. We'd love to help — can you tell us a bit more about what you need? We service most of {service_areas}.",
    ],
    default: [
      "Hey {name}! Thanks for reaching out to {business_name}. How can we help you today?",
    ],
  },
  bannedPhrases: [
    "guaranteed lowest price",
    "cheapest in town",
    "beat any quote",
    "competitors",
    "other plumbers",
    "DIY fix",
    "do it yourself",
  ],
  defaultServiceAreas: ["Gold Coast", "Brisbane South", "Tweed Heads", "Northern Rivers"],
  defaultTone: "friendly Australian casual-professional",
  leadFieldSchema: [
    { key: "issue_type", label: "Issue Type", type: "select", options: ["Blocked Drain", "Leak", "Burst Pipe", "Hot Water", "Toilet", "Tap", "Gas", "General"], required: true },
    { key: "urgency", label: "Urgency", type: "select", options: ["Emergency", "Today", "This Week", "Flexible"] },
    { key: "suburb", label: "Suburb", type: "text", required: true },
    { key: "property_type", label: "Property Type", type: "select", options: ["House", "Apartment", "Townhouse", "Commercial", "Rental"] },
    { key: "callback_preference", label: "Contact Preference", type: "select", options: ["Call", "Message", "Either"] },
  ],
  quickLeadKeywords: [
    "plumber", "plumbing", "drain", "blocked", "leak", "leaking", "burst",
    "hot water", "toilet", "tap", "gas fitting", "pipe", "sewer",
    "flooding", "cistern", "mixer",
  ],
};

// ============================================
// Electrical Profile (template for future use)
// ============================================

const ELECTRICAL_PROFILE: BusinessProfile = {
  industry: "electrical",
  industryLabel: "Electrical",
  serviceCategories: [
    "Power Points & Switches",
    "Lighting Installation",
    "Ceiling Fan Installation",
    "Switchboard Upgrades",
    "Safety Switches / RCDs",
    "Smoke Alarm Installation",
    "EV Charger Installation",
    "Solar & Battery",
    "Emergency Electrical",
    "General Electrical",
  ],
  commonIntents: [
    {
      key: "power_issue",
      label: "Power Issue",
      keywords: [
        /\b(no power|power out|lost power|blackout|tripped)\b/i,
        /\bswitchboard\s+(tripped|tripping|keeps tripping)/i,
      ],
      classification: "support_request",
      confidence: 0.90,
      urgency: "high",
    },
    {
      key: "lighting_install",
      label: "Lighting Installation",
      keywords: [
        /\b(light|lighting|downlight|led)\s+(install|upgrade|replace)/i,
        /\b(install|new|replace)\s+(light|lighting|downlight)/i,
      ],
      classification: "lead_interest",
      confidence: 0.88,
    },
    {
      key: "general_enquiry",
      label: "General Enquiry",
      keywords: [
        /\bneed\s+(an?\s+)?electrician/i,
        /\blooking\s+for\s+(an?\s+)?electrician/i,
      ],
      classification: "lead_interest",
      confidence: 0.80,
    },
  ],
  entityFields: [
    {
      key: "issue_type",
      label: "Issue Type",
      extractors: [
        { pattern: /\b(no power|power out|blackout)\b/i, value: "power outage" },
        { pattern: /\blight/i, value: "lighting" },
        { pattern: /\bswitchboard/i, value: "switchboard" },
        { pattern: /\bsafety switch|rcd/i, value: "safety switch" },
        { pattern: /\bev\s+charger/i, value: "ev charger" },
        { pattern: /\bsolar/i, value: "solar" },
        { pattern: /\bceiling\s+fan/i, value: "ceiling fan" },
      ],
    },
    {
      key: "urgency",
      label: "Urgency",
      extractors: [
        { pattern: /\b(emergency|no power|sparking|burning smell)\b/i, value: "emergency" },
        { pattern: /\b(asap|urgent|today)\b/i, value: "high" },
        { pattern: /\b(this week|soon)\b/i, value: "normal" },
      ],
    },
    {
      key: "location",
      label: "Location",
      extractors: [
        { pattern: /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(\d{4})\b/, value: "$match" },
      ],
    },
  ],
  replyExamples: [
    {
      classification: "support_request",
      templates: [
        "No worries! Flick us a DM with the details and we'll get a sparky out to you{link_suffix}",
        "We can sort that out — send us a message with your suburb and the issue{link_suffix}",
      ],
    },
    {
      classification: "lead_interest",
      templates: [
        "Thanks for reaching out! Drop us a DM and we'll help you out{link_suffix}",
        "Yep, we can definitely help! Shoot us a message{link_suffix}",
      ],
    },
  ],
  dmTemplates: {
    default: [
      "Hey {name}! Thanks for reaching out to {business_name}. How can we help you today?",
    ],
  },
  bannedPhrases: [
    "guaranteed lowest price",
    "cheapest in town",
    "competitors",
    "DIY",
  ],
  defaultServiceAreas: ["Gold Coast", "Brisbane South"],
  defaultTone: "friendly Australian casual-professional",
  leadFieldSchema: [
    { key: "issue_type", label: "Issue Type", type: "text", required: true },
    { key: "suburb", label: "Suburb", type: "text", required: true },
    { key: "property_type", label: "Property Type", type: "select", options: ["House", "Apartment", "Townhouse", "Commercial"] },
  ],
  quickLeadKeywords: [
    "electrician", "electrical", "power", "light", "lighting", "switchboard",
    "ceiling fan", "ev charger", "solar", "sparky", "rcd", "safety switch",
  ],
};

// ============================================
// Generic / Default Profile (fallback)
// ============================================

const GENERIC_PROFILE: BusinessProfile = {
  industry: "generic",
  industryLabel: "General Service Business",
  serviceCategories: [],
  commonIntents: [],
  entityFields: [
    {
      key: "urgency",
      label: "Urgency",
      extractors: [
        { pattern: /\b(asap|urgent|emergency|today|right now|immediately)\b/i, value: "high" },
        { pattern: /\b(this week|soon|when available)\b/i, value: "normal" },
      ],
    },
    {
      key: "location",
      label: "Location",
      extractors: [
        { pattern: /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(\d{4})\b/, value: "$match" },
      ],
    },
  ],
  replyExamples: [
    {
      classification: "default",
      templates: [
        "Thanks for reaching out! Send us a message and we'll help you out{link_suffix}",
        "Yep! Flick us a DM and we'll chat{link_suffix}",
      ],
    },
  ],
  dmTemplates: {
    default: [
      "Hey {name}! Thanks for reaching out to {business_name}. How can we help you today?",
    ],
  },
  bannedPhrases: [],
  defaultServiceAreas: [],
  defaultTone: "friendly professional",
  leadFieldSchema: [
    { key: "service_needed", label: "Service Needed", type: "text", required: true },
    { key: "suburb", label: "Suburb", type: "text" },
  ],
  quickLeadKeywords: [],
};

// ============================================
// Profile Registry
// ============================================

const BUILT_IN_PROFILES: Record<string, BusinessProfile> = {
  hvac: HVAC_PROFILE,
  plumbing: PLUMBING_PROFILE,
  electrical: ELECTRICAL_PROFILE,
  generic: GENERIC_PROFILE,
};

// In-memory cache for DB-loaded profiles (TTL: 10 minutes)
const profileCache = new Map<string, { profile: BusinessProfile; ts: number }>();
const PROFILE_CACHE_TTL = 10 * 60 * 1000;

let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

/**
 * Get the business profile for a given business.
 * Checks DB for custom profile first, then falls back to built-in industry profile.
 */
export async function getBusinessProfile(businessId: string): Promise<BusinessProfile> {
  // Check cache
  const cached = profileCache.get(businessId);
  if (cached && Date.now() - cached.ts < PROFILE_CACHE_TTL) {
    return cached.profile;
  }

  const supabase = getSupabase();

  // Check if business has a custom profile in DB
  const { data: dbProfile } = await supabase
    .from("business_profiles")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  let profile: BusinessProfile;

  if (dbProfile) {
    // Merge DB overrides with built-in profile
    const base = BUILT_IN_PROFILES[dbProfile.industry] || GENERIC_PROFILE;
    profile = mergeProfile(base, dbProfile);
  } else {
    // Check the business table for industry field
    const { data: biz } = await supabase
      .from("businesses")
      .select("industry")
      .eq("id", businessId)
      .maybeSingle();

    const industry = biz?.industry || "generic";
    profile = BUILT_IN_PROFILES[industry] || GENERIC_PROFILE;
  }

  profileCache.set(businessId, { profile, ts: Date.now() });
  return profile;
}

/**
 * Get a built-in profile by industry key.
 */
export function getBuiltInProfile(industry: string): BusinessProfile {
  return BUILT_IN_PROFILES[industry] || GENERIC_PROFILE;
}

/**
 * List all available built-in industry profiles.
 */
export function listIndustries(): Array<{ key: string; label: string }> {
  return Object.entries(BUILT_IN_PROFILES)
    .filter(([key]) => key !== "generic")
    .map(([key, p]) => ({ key, label: p.industryLabel }));
}

/**
 * Clear profile cache for a business (e.g. after settings update).
 */
export function clearProfileCache(businessId?: string): void {
  if (businessId) {
    profileCache.delete(businessId);
  } else {
    profileCache.clear();
  }
}

// ============================================
// Profile-driven entity extraction
// ============================================

/**
 * Extract entities from text using the business profile's field definitions.
 * Returns a flat object of field key → extracted value.
 */
export function extractProfileEntities(
  text: string,
  profile: BusinessProfile
): Record<string, string> {
  const entities: Record<string, string> = {};

  for (const field of profile.entityFields) {
    for (const extractor of field.extractors) {
      if (extractor.value === "$match") {
        // Special: use the regex match itself
        const match = text.match(extractor.pattern);
        if (match) {
          entities[field.key] = match[0];
          break;
        }
      } else {
        if (extractor.pattern.test(text)) {
          entities[field.key] = extractor.value;
          break;
        }
      }
    }
  }

  return entities;
}

/**
 * Match text against profile intents.
 * Returns the best matching intent or null.
 */
export function matchProfileIntent(
  text: string,
  profile: BusinessProfile
): BusinessIntent | null {
  let bestMatch: BusinessIntent | null = null;
  let bestConfidence = 0;

  for (const intent of profile.commonIntents) {
    for (const kw of intent.keywords) {
      if (kw.test(text)) {
        if (intent.confidence > bestConfidence) {
          bestMatch = intent;
          bestConfidence = intent.confidence;
        }
        break; // Don't need to check more keywords for this intent
      }
    }
  }

  return bestMatch;
}

/**
 * Get reply templates for a given classification from the profile.
 */
export function getProfileReplyTemplates(
  classification: string,
  profile: BusinessProfile
): string[] {
  const example = profile.replyExamples.find((e) => e.classification === classification);
  if (example) return example.templates;

  // Fall back to default
  const def = profile.replyExamples.find((e) => e.classification === "default");
  return def?.templates || ["Thanks for reaching out! Send us a message and we'll help you out{link_suffix}"];
}

/**
 * Get DM templates for a given classification from the profile.
 */
export function getProfileDmTemplate(
  classification: string,
  profile: BusinessProfile
): string {
  const templates = profile.dmTemplates[classification] || profile.dmTemplates["default"] || [];
  if (templates.length === 0) {
    return "Hey {name}! Thanks for reaching out to {business_name}. How can we help?";
  }
  return templates[Math.floor(Math.random() * templates.length)];
}

/**
 * Check if reply text contains any banned phrases for the business profile.
 */
export function containsBannedPhrase(text: string, profile: BusinessProfile): boolean {
  const lower = text.toLowerCase();
  return profile.bannedPhrases.some((phrase) => lower.includes(phrase.toLowerCase()));
}

// ============================================
// Merge helper — DB overrides on top of built-in
// ============================================

function mergeProfile(base: BusinessProfile, dbRow: any): BusinessProfile {
  // Start with the built-in profile as base
  const merged = { ...base };

  // Override simple fields if present in DB
  if (dbRow.industry_label) merged.industryLabel = dbRow.industry_label;
  if (dbRow.service_categories?.length) merged.serviceCategories = dbRow.service_categories;
  if (dbRow.banned_phrases?.length) merged.bannedPhrases = dbRow.banned_phrases;
  if (dbRow.default_service_areas?.length) merged.defaultServiceAreas = dbRow.default_service_areas;
  if (dbRow.default_tone) merged.defaultTone = dbRow.default_tone;
  if (dbRow.quick_lead_keywords?.length) merged.quickLeadKeywords = dbRow.quick_lead_keywords;

  // Custom reply templates override built-in ones
  if (dbRow.reply_templates && typeof dbRow.reply_templates === "object") {
    const customReplies = dbRow.reply_templates as Record<string, string[]>;
    merged.replyExamples = merged.replyExamples.map((re) => {
      if (customReplies[re.classification]) {
        return { ...re, templates: customReplies[re.classification] };
      }
      return re;
    });
  }

  // Custom DM templates
  if (dbRow.dm_templates && typeof dbRow.dm_templates === "object") {
    merged.dmTemplates = { ...merged.dmTemplates, ...dbRow.dm_templates };
  }

  // Custom lead field schema
  if (dbRow.lead_field_schema?.length) {
    merged.leadFieldSchema = dbRow.lead_field_schema;
  }

  return merged;
}
