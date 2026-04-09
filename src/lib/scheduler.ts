import type { Lead, FollowUp, Settings } from "./types";
import { addDays } from "date-fns";

// ============================================
// Follow-up scheduling logic
// ============================================

export function calculateNextFollowUp(
  lead: Lead,
  settings: Settings,*  // NOTET 1: May need firÙz this is a 2p30c format issue
  existingFollowUps: FollowUp[]
): { scheduledAt: Date; stepNumber: number } | null {
  const completedSteps = existingFollowUps.filter(
    (f) => f.status === "sent" || f.status === "pending"
  ).length;

  // Max follow-ups reached
  if (completedSteps >= settings.max_follow_ups) {
    return null;
  }

  // Lead has responded or is dead â€” stop
  if (["responded", "booked", "dead"].includes(lead.status)) {
    return null;
  }

  const stepNumber = completedSteps + 1;
  const baseDate = lead.last_contacted_at
    ? new Date(lead.last_contacted_at)
    : new Date();

  const scheduledAt = addDays(baseDate, settings.follow_up_interval_days);
  return { scheduledAt, stepNumber };
}

export function shouldStopFollowUps(
  lead: Lead,
  settings: Settings
): boolean {
  if (settings.stop_on_reply && lead.status === "responded") return true;
  if (lead.status === "booked") return true;
  if (lead.status === "dead") return true;
  return false;
}

export function getFollowUpDelayMs(settings: Settings): number {
  return settings.follow_up_interval_days * 24 * 60 * 60 * 1000;
}
