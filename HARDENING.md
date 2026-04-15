# AutoFollowUp AI — Production Hardening (2026-04)

This pass adds observability, async processing, fallbacks, and a debug panel
to the comment automation pipeline. Messenger handling is untouched.

## New event flow

```
Meta POST /api/webhook
  │
  ▼
 1. Signature verify (or bypass via META_SKIP_SIGNATURE_CHECK)
 2. Parse JSON
 3. normalizeWebhookEvents()  → [message|comment] events
 4. Persist row in webhook_deliveries (status=received, raw_excerpt, hash)
 5. For each event:
     • message  → handleMessengerMessage  (inline, unchanged)
     • comment  → enqueueJob(handle_comment, dedupe_key=comment:{pageId}:{commentId})
 6. Update webhook_deliveries.status=processed  (+ drop_reasons)
 7. 200 OK  (Meta is acked fast)

Worker: POST /api/jobs/process (cron / warm ping, protected by CRON_SECRET)
  │
  ▼
 1. claim_next_job() RPC — SELECT ... FOR UPDATE SKIP LOCKED
 2. handleComment(event):
     • dedupe check on comments table
     • fetch-full-comment fallback (Graph) if text/sender missing
     • classifyByRules() → cheap deterministic intent
     • skipAi if rules are confident; else classifyComment() (Groq)
     • lead history lookup
     • decideCommentAction()   (existing engine, unchanged)
     • canSendPrivateReply()   (NEW preflight guard — authoritative)
     • executeAction(finalAction, ...)
     • write full decision_trace to automation_logs
 3. completeJob / failJob (exponential backoff, max_attempts=5)
```

## Files added

| Path | Purpose |
|---|---|
| `supabase/migrations/20260415_hardening.sql` | tables + indexes + `claim_next_job` RPC |
| `src/lib/observability/webhookLog.ts` | structured log + `webhook_deliveries` persistence |
| `src/lib/meta/commentFetch.ts` | Graph read-only fallbacks (`getCommentById`, `getCommentEligibility`) |
| `src/lib/conversation/rulesClassifier.ts` | deterministic rule-first intent |
| `src/lib/conversation/privateReplyGuard.ts` | `canSendPrivateReply` preflight |
| `src/lib/jobs/queue.ts` | `enqueueJob`, `claimNextJob`, `completeJob`, `failJob` |
| `src/app/api/jobs/process/route.ts` | worker endpoint |
| `src/app/api/diag/health/route.ts` | extended health + feed-staleness warning |
| `src/app/admin/webhooks/page.tsx` | internal debug panel (`?secret=$CRON_SECRET`) |
| `src/lib/integrations/serviceM8.ts` | clean stub for future ServiceM8 handoff |

## Files changed

| Path | Change |
|---|---|
| `src/app/api/webhook/route.ts` | adds observability, enqueues comments (opt-in inline via `WEBHOOK_INLINE_COMMENTS=true`) |
| `src/lib/conversation/commentHandler.ts` | Graph fetch fallback, rules-first, preflight guard, decision trace, `logDrop` |

## SQL

Apply `supabase/migrations/20260415_hardening.sql`. It's idempotent.
Adds:
* `webhook_deliveries` — one row per inbound POST, with `raw_excerpt` (first 1KB),
  `payload_hash`, `drop_reasons`, `status`.
* `automation_jobs` — queue with unique `dedupe_key`, exponential retry.
* `claim_next_job(p_lock_token, p_types)` — atomic claim RPC.
* `automation_logs` extra columns: `decision_trace jsonb`, `drop_reason`,
  `rule_intent`, `rule_confidence`.
* `settings` extra columns: `comment_user_cooldown_hours` (default 24),
  `comment_max_actions_per_comment` (default 1).

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `META_APP_SECRET` | yes (prod) | HMAC verification |
| `META_SKIP_SIGNATURE_CHECK` | temp debug | bypass signature check — REMOVE once APP_SECRET confirmed |
| `WEBHOOK_INLINE_COMMENTS` | no | set `true` to process comments synchronously in webhook route (debug only) |
| `CRON_SECRET` | yes | protects `/api/jobs/process` and `/admin/webhooks` |
| `FEED_STALE_WARN_HOURS` | no | default 6; health endpoint warns if no feed event received in this window |
| `SERVICEM8_API_KEY` | future | when set, enables ServiceM8 handoff (currently stubbed) |

## Troubleshooting checklist

Run down this list if a comment doesn't result in a DM:

1. **Is Meta actually delivering?** `GET /api/diag/health` — look at
   `webhook.comment_deliveries_recent`. If 0, the problem is Meta-side.
   Check Meta App Dashboard > Webhooks > Recent Deliveries. If the
   `feed` field isn't subscribed at the *app* level, Meta will never
   POST comment events.
2. **Did the request get rejected at the door?** Check `webhook_deliveries`
   for rows with `status='rejected'`. `error=SIGNATURE_HEADER_MISSING` or
   `SIGNATURE_MISMATCH` → your `META_APP_SECRET` is stale. Set
   `META_SKIP_SIGNATURE_CHECK=true` temporarily, verify it now works,
   then fetch the correct app secret and remove the bypass.
3. **Did the event normalize?** Check `webhook_deliveries.normalized_count`
   and `event_types`. If `event_types` doesn't contain `"comment"`, the
   normalizer filtered it. Common filter: self-comment (`from.id === pageId`).
4. **Did it enqueue?** Look at `automation_jobs` for a row with
   `dedupe_key='comment:{pageId}:{commentId}'`. If missing, the enqueue
   failed (check `webhook_deliveries.drop_reasons`).
5. **Did the worker run?** `POST /api/jobs/process` with
   `Authorization: Bearer $CRON_SECRET`. Check the response `processed` count.
6. **Did the comment get dropped inside the handler?** Check
   `automation_logs` where `channel='facebook_comment'` and
   `event_type='comment_dropped'`. The `drop_reason` tells you why.
7. **Did the guard block?** `automation_logs.decision_trace.guard.reason`.
   Common reasons: `graph_can_reply_privately_false`, `user_in_cooldown`,
   `already_actioned_comment`, `missing_sender_id`.
8. **Did the private reply API fail?** Look at `comments.private_reply_sent_at`
   and `automation_logs` rows where `success=false`. Meta error code 10 or
   "not authorized" usually means the commenter has Messenger blocked or
   the 7-day private reply window has passed — fall back to public reply.

## Meta app config — external blockers we can't fix from code

* **Pages `feed` permission not subscribed at the app level** — fix in
  Facebook App Dashboard → Webhooks → Page → Subscribe to `feed`.
* **App in Dev Mode with the commenter not added as a tester** — in Dev
  Mode, Meta only sends webhooks for actions by roles (admin, tester,
  developer). A random user's comment will be dropped by Meta before it
  ever reaches us. Fix: app to Live Mode with App Review for the
  required permissions (`pages_manage_engagement`, `pages_read_user_content`,
  `pages_manage_metadata`, `pages_messaging`).
* **Page token missing scopes** — page token must include
  `pages_messaging`, `pages_manage_engagement`, `pages_read_user_content`.
  Confirm via `GET /me/permissions?access_token=...`.

## Assumptions

* Existing Messenger DM handling remains the synchronous path — we did not
  enqueue messages, only comments, to minimise change.
* `comments` table has a unique index on `comment_id` (the existing dedupe
  check relies on it).
* `settings` is a single-row table keyed by user; `loadSettings` returns
  the first user's row (existing behaviour, unchanged).
* `classify_next_job` RPC uses `gen_random_uuid()` — `pgcrypto` extension
  must be enabled. On Supabase it is by default.
