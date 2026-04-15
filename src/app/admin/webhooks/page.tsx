// ============================================
// Internal admin — recent webhook deliveries + comment decisions + failures
//
// Minimal server-rendered page. Protected by ?secret= matching CRON_SECRET.
// Intentionally un-pretty — this is a debug panel, not a dashboard.
// ============================================

import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface PageProps {
  searchParams: { [k: string]: string | string[] | undefined };
}

export default async function AdminWebhooksPage({ searchParams }: PageProps) {
  const secret = searchParams.secret;
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return (
      <main style={{ padding: 24, fontFamily: "ui-monospace, monospace" }}>
        <h1>Unauthorized</h1>
        <p>Append ?secret=&lt;CRON_SECRET&gt; to view.</p>
      </main>
    );
  }

  const filter = typeof searchParams.filter === "string" ? searchParams.filter : "";
  const search = typeof searchParams.q === "string" ? searchParams.q : "";
  const supabase = db();

  const { data: deliveries } = await supabase
    .from("webhook_deliveries")
    .select(
      "id, created_at, request_id, object_type, event_types, signature_verified, signature_skipped, normalized_count, dropped_count, drop_reasons, status, error"
    )
    .order("created_at", { ascending: false })
    .limit(40);

  let logsQuery = supabase
    .from("automation_logs")
    .select(
      "id, created_at, event_type, action_taken, drop_reason, rule_intent, rule_confidence, details, decision_trace, success"
    )
    .eq("channel", "facebook_comment")
    .order("created_at", { ascending: false })
    .limit(40);

  if (filter === "failed") logsQuery = logsQuery.eq("success", false);
  if (filter === "dropped") logsQuery = logsQuery.eq("action_taken", "drop");
  if (filter === "replied")
    logsQuery = logsQuery.in("action_taken", [
      "send_private_reply",
      "public_reply_only",
      "public_reply_and_wait",
    ]);
  if (filter === "escalated")
    logsQuery = logsQuery.eq("action_taken", "escalate_to_human");

  const { data: logs } = await logsQuery;

  const filteredLogs = search
    ? (logs || []).filter((l) => JSON.stringify(l).includes(search))
    : logs || [];

  const { data: jobs } = await supabase
    .from("automation_jobs")
    .select(
      "id, created_at, type, status, attempts, next_run_at, last_error, dedupe_key"
    )
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <main
      style={{
        padding: 16,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
        color: "#111",
      }}
    >
      <h1 style={{ fontSize: 16 }}>AutoFollowUp AI — admin/webhooks</h1>
      <form method="GET" style={{ marginBottom: 12 }}>
        <input type="hidden" name="secret" value={secret as string} />
        <label>
          filter:&nbsp;
          <select name="filter" defaultValue={filter}>
            <option value="">all</option>
            <option value="failed">failed</option>
            <option value="dropped">dropped</option>
            <option value="replied">replied</option>
            <option value="escalated">escalated</option>
          </select>
        </label>
        &nbsp;&nbsp;
        <label>
          search:&nbsp;
          <input
            name="q"
            defaultValue={search}
            placeholder="comment id or sender id"
            style={{ width: 260 }}
          />
        </label>
        &nbsp;
        <button type="submit">apply</button>
      </form>

      <h2 style={{ fontSize: 14 }}>Recent webhook deliveries</h2>
      <Table
        columns={[
          "time",
          "req",
          "object",
          "events",
          "sig",
          "norm",
          "drop",
          "status",
          "error",
        ]}
        rows={(deliveries || []).map((d) => [
          d.created_at,
          d.request_id,
          d.object_type || "-",
          JSON.stringify(d.event_types),
          d.signature_skipped
            ? "skipped"
            : d.signature_verified
              ? "ok"
              : "-",
          String(d.normalized_count),
          String(d.dropped_count) +
            (d.drop_reasons && (d.drop_reasons as unknown[]).length
              ? ":" + JSON.stringify(d.drop_reasons)
              : ""),
          d.status,
          d.error || "",
        ])}
      />

      <h2 style={{ fontSize: 14, marginTop: 24 }}>
        Recent comment decisions {filter && `[${filter}]`}
      </h2>
      <Table
        columns={[
          "time",
          "action",
          "rule",
          "conf",
          "drop_reason",
          "details",
        ]}
        rows={filteredLogs.map((l) => [
          l.created_at,
          l.action_taken || "-",
          l.rule_intent || "-",
          l.rule_confidence != null ? String(l.rule_confidence) : "-",
          l.drop_reason || "-",
          (l.details && JSON.stringify(l.details).slice(0, 200)) || "",
        ])}
      />

      <h2 style={{ fontSize: 14, marginTop: 24 }}>Jobs (last 20)</h2>
      <Table
        columns={["time", "type", "status", "attempts", "next_run", "error"]}
        rows={(jobs || []).map((j) => [
          j.created_at,
          j.type,
          j.status,
          String(j.attempts),
          j.next_run_at,
          (j.last_error || "").slice(0, 200),
        ])}
      />
    </main>
  );
}

function Table({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <table
      cellPadding={4}
      style={{
        borderCollapse: "collapse",
        width: "100%",
        border: "1px solid #ccc",
      }}
    >
      <thead style={{ background: "#eee" }}>
        <tr>
          {columns.map((c) => (
            <th
              key={c}
              style={{ border: "1px solid #ccc", textAlign: "left" }}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} style={{ padding: 8 }}>
              (none)
            </td>
          </tr>
        ) : (
          rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td
                  key={j}
                  style={{
                    border: "1px solid #eee",
                    verticalAlign: "top",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
