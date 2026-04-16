// ============================================
// Job worker — POST /api/jobs/process
// Claims up to N pending jobs and runs them. Safe to call from a
// Vercel cron or a warm ping. Requires CRON_SECRET.
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { claimNextJob, completeJob, failJob } from "@/lib/jobs/queue";
import { handleComment } from "@/lib/conversation/commentHandler";
import { handleMessengerMessage } from "@/lib/conversation/engine";
import { resolveBusinessByPage } from "@/lib/business/resolve";
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
    status: "done" | "failed";
    error?: string;
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

      // Resolve business context from the job's business_id or the event's pageId
      const bizCtx = payload.business_id
        ? await resolveBusinessByPage(payload.event.pageId)
        : await resolveBusinessByPage(payload.event.pageId);

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
  return POST(
    new NextRequest(req.url, {
      method: 