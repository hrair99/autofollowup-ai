// ============================================
// AI Intent + Entity Classification
// Classifies every inbound message for the conversation engine
// ============================================

import { groqJson } from "./groq-client";
import type { AiClassification, Intent, UrgencyLevel, BookingReadiness, Sentiment, ExtractedEntities } from "../types";

interface ClassificationResult {
  intent: Intent;
  urgency: UrgencyLevel;
  service_type: string | null;
  location_mention: string | null;
  booking_readiness: BookingReadiness;
  pricing_sensitivity: boolean;
  sentiment: Sentiment;
  entities: ExtractedEntities;
  confidence: number;
}