// ============================================
// Webhook observability — structured logs + Supabase persistence
// ============================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;

function db(): DB {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface WebhookLogInput {
  requestId: string;
  objectType: string | null;
  eventTypes: string[];
  rawPresent: boolean;
  signatureVerified: boolean;
  signatureSkipped: boolean;
  normalizedCount: number;
  droppedCount: number;
  dropReasons: string[];
  status: "received" | "processed" | "error" | "rejected";
  error?: string;
  rawBody?: string;
}

const EXCERPT_MAX = 1024;

export function makeRequestId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export function structuredLog(input: WebhookLogInput): void {
  // eslint-disable-next-line no-console
  console.log(
    "[Webhook]",
    JSON.stringify({
      ts: new Date().toISOString(),
      request_id: input.requestId,
      object: input.objectType,
      event_types: input.eventTypes,
      signature_verified: input.signatureVerified,
      signature_skipped: input.signatureSkipped,
      normalized: input.normalizedCount,
      dropped: input.droppedCount,
      drop_reasons: input.dropReasons,
      status: input.status,
      error: input.error,
    })
  );
}

export async function persistWebhookDelivery(input: WebhookLogInput): Promise<void> {
  try {
    const raw = input.rawBody || "";
    const hash = raw
      ? crypto.createHash("sha256").update(raw).digest("hex")
      : null;
    const excerpt = raw ? raw.substring(0, EXCERPT_MAX) : null;

    await db().from("webhook_deliveries").insert({
      request_id: input.requestId,
      object_type: input.objectType,
      event_types: input.eventTypes,
      raw_present: input.rawPresent,
      signature_verified: input.signatureVerified,
      signature_skipped: input.signatureSkipped,
      normalized_count: input.normalizedCount,
      dropped_count: input.droppedCount,
      drop_reasons: input.dropReasons,
      status: input.status,
      error: input.error || null,
      raw_excerpt: excerpt,
      payload_hash: hash,
    });
  } catch (e) {
    // Never let observability block the webhook path
    // eslint-disable-next-line no-console
    console.error("[Webhook] Failed to persist delivery log:", e);
  }
}

export async function updateDeliveryStatus(
  requestId: string,
  patch: Partial<Pick<WebhookLogInput, "status" | "error" | "normalizedCount" | "droppedCount" | "dropReasons">>
): Promise<void> {
  try {
    await db()
      .from("webhook_deliveries")
      .update({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        ...(patch.normalizedCount !== undefined
          ? { normalized_count: patch.normalizedCount }
          : {}),
        ...(patch.droppedCount !== undefined
          ? { dropped_count: patch.droppedCount }
          : {}),
        ...(patch.dropReasons !== undefined
          ? { drop_reasons: patch.dropReasons }
          : {}),
      })
      .eq("request_id", requestId);
  } catch (e) {
    /