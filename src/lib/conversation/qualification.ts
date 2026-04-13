// ============================================
// Qualification Flow — What info do we need? What to ask next?
// ============================================

import type { Lead, QualificationData, NextAction, AiClassification, ExtractedEntities } from "../types";

interface QualificationField {
  key: keyof QualificationData;
  askAction: NextAction;
  priority: number; // Lower = ask first
}

const QUALIFICATION_FIELDS: QualificationField[] = [
  { key: "location", askAction: "ask_location", priority: 1 },
  { key: "job_type", askAction: "ask_job_type", priority: 2 },
  { key: "urgency", askAction: "ask_urgency", priority: 3 },
  { key: "appliance_type", askAction: "ask_details", priority: 4 },
];

/**
 * Merge newly extracted entities into the existing qualification data.
 */
export function mergeQualificationData(
  existing: QualificationData,
  entities: ExtractedEntities,
  classification: AiClassification
): QualificationData {
  const merged = { ...existing };

  // Merge entities
  if (entities.suburb && !merged.location) {
    merged.location = entities.suburb;
  }
  if (entities.job_type && !merged.job_type) {
    merged.job_type = entities.job_type;
  }
  if (entities.urgency && !merged.urgency) {
    merged.urgency = entities.urgency;
  }
  if (entities.appliance_type && !merged.appliance_type) {
    merged.appliance_type = entities.appliance_type;
  }
  if (entities.preferred_timing && !merged.preferred_timing) {
    merged.preferred_timing = entities.preferred_timing;
  }

  // Also extract from classification
  if (classification.location_mention && !merged.location) {
    merged.location = classification.location_mention;
  }
  if (classification.service_type && !merged.service_type) {
    merged.service_type = classification.service_type;
  }

  return merged;
}

/**
 * Get the list of missing qualification fields.
 */
export function getMissingFields(qualData: QualificationData): QualificationField[] {
  return QUALIFICATION_FIELDS.filter((f) => !qualData[f.key])
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Determine the next qualification action.
 * Returns the highest-priority missing field's ask action, or null if fully qualified.
 */
export function getNextQualificationAction(lead: Lead): NextAction | null {
  const missing = getMissingFields(lead.qualification_data || {});
  if (missing.length === 0) return null;
  return missing[0].askAction;
}

/**
 * Calculate qualification completeness as a percentage.
 */
export function qualificationCompleteness(qualData: QualificationData): number {
  const total = QUALIFICATION_FIELDS.length;
  const filled = QUALIFICATION_FIELDS.filter((f) => qualData[f.key]).length;
  return Math.round((filled / total) * 100);
}

/**
 * Check if we have minimum required info for enquiry form push.
 */
export function hasMinimumQualification(qualData: QualificationData): boolean {
  return !!(qualData.location && qualData.job_type);
}
