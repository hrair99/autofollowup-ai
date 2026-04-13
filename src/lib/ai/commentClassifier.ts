// ============================================
// Comment Classifier — Deterministic rules + AI classification
// Classifies Facebook comments for lead signal detection
// ============================================

import { groqJson } from "./groq-client";

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
