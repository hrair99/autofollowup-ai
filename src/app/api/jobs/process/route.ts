// ============================================
// Job worker — POST /api/jobs/process
// Claims up to N pending jobs and runs them. Safe to call from a
// Vercel cron or a warm ping. Requires CRON_SECRET.
// Checks subscription gate + usage limits before processing.
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { claimNextJob, completeJob, failJob } from "@/lib/jobs/queue";
import { handleComment } from "@/lib/conversation/commentHandler";
import { handleMessengerMessage } from "@/lib/conversation/engine";
import { resolveBusinessByPage } from "@/lib/business/resolve";
import { checkSubscriptionGate, checkAndIncrementUsage } from "@/lib/billing/stripe";
import type { NormalizedWebhookEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH = 10;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // if not set, allow (dev)
  const header =
    req.headers.get("authorization") ||
    req.headers.get("x-cron-secret") ||
    "";
  return header === secret || header === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }
  const results: Array<{
    jobId: string;
    type: string;
    status: "done" | "failed" | "skipped";
    error?: string;
    reason?: string;
  }> = [];

  for (let i = 0; i < MAX_BATCH; i++) {
    const job = await claimNextJob(["handle_comment", "handle_message"]);
    if (!job) break;

    try {
      const payload = job.payload as {
        event: NormalizedWebhookEvent;
        business_id?: string;
      };
      if (!payload?.event) throw new Error("missing_event_payload");

      // Resolve business context from the event's pageId
      const bizCtx = await resolveBusinessByPage(payload.event.pageId);

      // --- Subscription + Usage gates (fail-open) ---
      // These gates check billing status but NEVER block if they error.
      // We'd rather process a job for free than silently drop it.
      if (bizCtx) {
        try {
          const subGate = await checkSubscriptionGate(bizCtx.businessId);
          if (!subGate.allowed) {
            await completeJob(job.id);
            results.push({
              jobId: job.id,
              type: job.type,
              status: "skipped",
              reason: `subscription_blocked:${subGate.reason}`,
            });
            continue;
          }

          // Usage gate
          const metric = job.type === "handle_comment" ? "comments_processed" : "dms_sent";
          const usageGate = await checkAndIncrementUsage(
            bizCtx.businessId,
            metric as any,
            subGate.plan
          );
          if (!usageGate.allowed) {
            await completeJob(job.id);
            results.push({
              jobId: job.id,
              type: job.type,
              status: "skipped",
              reason: usageGate.reason,
            });
            continue;
          }
        } catch (gateError) {
          // Billing check failed — process the job anyway
          console.error(`[JobProcessor] Billing gate error for ${bizCtx.businessId}: ${gateError} — processing anyway`);
        }
      }

      if (job.type === "handle_comment") {
        await handleComment(payload.event, bizCtx ?? undefined);
      } else if (job.type === "handle_message") {
        await handleMessengerMessage(payload.event, bizCtx ?? undefined);
      } else {
        throw new Error(`unknown_job_type:${job.type}`);
      }
      await completeJob(job.id);
      results.push({ jobId: job.id, type: job.type, status: "done" });
    } catch (e) {
      const msg = String(e);
      await failJob(job.id, {
        attempts: job.attempts,
        maxAttempts: job.max_attempts,
        error: msg,
      });
      results.push({
        jobId: job.id,
        type: job.type,
        status: "failed",
        error: msg,
      });
    }
  }

  return NextResponse.json({
    processed: results.length,
    results,
  });
}

// Convenience: allow GET with ?secret= for manual debugging.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }
  // Forward as POST
  const headers = new Headers(req.headers);
  if (secret) headers.set("x-cron-secret", secret);
  return POST(new NextRequest(req.url, { method: "POST", headers }));
}
