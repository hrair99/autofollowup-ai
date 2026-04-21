import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getUserBusinessId } from "@/lib/business/resolve";
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Zap,
} from "lucide-react";

interface AutomationJob {
  id: string;
  type: string;
  status: "queued" | "processing" | "failed" | "dead" | "done";
  last_error: string | null;
  attempts: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
}

interface AutomationLog {
  id: string;
  event_type: string;
  channel: string;
  action_taken: string;
  error_message: string | null;
  created_at: string;
}

interface WebhookDelivery {
  id: string;
  received_at: string;
  object_type: string;
  status: string;
  normalized_count: number;
  dropped_count: number;
  error: string | null;
  signature_verified: boolean;
}

export default async function OperationsPage() {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Get business ID
  const businessId = await getUserBusinessId(user.id);
  if (!businessId) redirect("/dashboard");

  // Determine scope column (business_id vs user_id)
  // For automation tables, use business_id if available
  const scopeColumn = "business_id";

  // Fetch failed and dead jobs
  const { data: failedJobs } = await supabase
    .from("automation_jobs")
    .select(
      "id, type, status, last_error, attempts, max_attempts, created_at, updated_at"
    )
    .in("status", ["failed", "dead"])
    .eq(scopeColumn, businessId)
    .order("updated_at", { ascending: false })
    .limit(30);

  // Fetch recent errors from automation_logs
  const { data: recentErrors } = await supabase
    .from("automation_logs")
    .select(
      "id, event_type, channel, action_taken, error_message, created_at"
    )
    .eq(scopeColumn, businessId)
    .eq("success", false)
    .order("created_at", { ascending: false })
    .limit(30);

  // Fetch webhook deliveries
  const { data: webhookDeliveries } = await supabase
    .from("webhook_deliveries")
    .select(
      "id, received_at, object_type, status, normalized_count, dropped_count, error, signature_verified"
    )
    .eq("business_id", businessId)
    .order("received_at", { ascending: false })
    .limit(50);

  // Fetch last 24h errors count for stats
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: last24hErrors } = await supabase
    .from("automation_logs")
    .select("id", { count: "exact", head: true })
    .eq(scopeColumn, businessId)
    .eq("success", false)
    .gte("created_at", twentyFourHoursAgo);

  // Calculate stats
  const totalFailedJobs = failedJobs?.length || 0;
  const totalErrors24h = last24hErrors || 0;

  const totalWebhooks = webhookDeliveries?.length || 0;
  const successfulWebhooks = webhookDeliveries?.filter(
    (w) => w.status === "success"
  ).length || 0;
  const webhookSuccessRate =
    totalWebhooks > 0 ? Math.round((successfulWebhooks / totalWebhooks) * 100) : 0;
  const failedWebhooks = totalWebhooks - successfulWebhooks;

  const typedFailedJobs = (failedJobs || []) as AutomationJob[];
  const typedRecentErrors = (recentErrors || []) as AutomationLog[];
  const typedWebhookDeliveries = (webhookDeliveries || []) as WebhookDelivery[];

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Operations</h1>
        <p className="mt-1 text-sm text-gray-500">
          Monitor automation health, delivery failures, and webhook processing.
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Failed Jobs</p>
              <p className="text-3xl font-bold text-red-600 mt-1">
                {totalFailedJobs}
              </p>
            </div>
            <AlertTriangle className="h-8 w-8 text-red-500 opacity-20" />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Automation jobs stuck in failed or dead state
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">
                Errors (24h)
              </p>
              <p className="text-3xl font-bold text-amber-600 mt-1">
                {totalErrors24h}
              </p>
            </div>
            <AlertCircle className="h-8 w-8 text-amber-500 opacity-20" />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Failed automation actions in the last 24 hours
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">
                Webhook Success Rate
              </p>
              <p className="text-3xl font-bold text-emerald-600 mt-1">
                {webhookSuccessRate}%
              </p>
            </div>
            <CheckCircle2 className="h-8 w-8 text-emerald-500 opacity-20" />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {successfulWebhooks} of {totalWebhooks} recent deliveries succeeded
          </p>
        </div>
      </div>

      {/* Failed & Dead Jobs Section */}
      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              Failed & Dead Jobs
            </h2>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Automation jobs that have failed or reached max retry attempts
          </p>
        </div>

        {typedFailedJobs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Attempts
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Last Error
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Created
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {typedFailedJobs.map((job) => (
                  <tr
                    key={job.id}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-6 py-3 font-medium text-gray-900">
                      {job.type}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${
                          job.status === "dead"
                            ? "bg-red-100 text-red-800"
                            : "bg-yellow-100 text-yellow-800"
                        }`}
                      >
                        {job.status === "dead" ? (
                          <AlertTriangle className="h-3 w-3" />
                        ) : (
                          <Clock className="h-3 w-3" />
                        )}
                        {job.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      {job.attempts}/{job.max_attempts}
                    </td>
                    <td className="px-6 py-3 text-gray-600 max-w-xs truncate">
                      {job.last_error
                        ? job.last_error.substring(0, 50) +
                          (job.last_error.length > 50 ? "..." : "")
                        : "—"}
                    </td>
                    <td className="px-6 py-3 text-gray-500 text-xs">
                      {new Date(job.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-3 text-gray-500 text-xs">
                      {new Date(job.updated_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-3 opacity-20" />
            <p className="text-gray-600 font-medium">No failed jobs</p>
            <p className="text-sm text-gray-500 mt-1">
              All automation jobs are processing successfully
            </p>
          </div>
        )}
      </section>

      {/* Recent Errors Section */}
      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              Recent Automation Errors
            </h2>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Failed automation actions from the automation log
          </p>
        </div>

        {typedRecentErrors.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Event Type
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Channel
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Action
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Error
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {typedRecentErrors.map((error) => (
                  <tr
                    key={error.id}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-6 py-3 font-medium text-gray-900">
                      {error.event_type}
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                        {error.channel}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      {error.action_taken || "—"}
                    </td>
                    <td className="px-6 py-3 text-red-600 max-w-sm truncate">
                      {error.error_message || "—"}
                    </td>
                    <td className="px-6 py-3 text-gray-500 text-xs">
                      {new Date(error.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-3 opacity-20" />
            <p className="text-gray-600 font-medium">No recent errors</p>
            <p className="text-sm text-gray-500 mt-1">
              All automation actions completed successfully
            </p>
          </div>
        )}
      </section>

      {/* Webhook Health Section */}
      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              Webhook Health
            </h2>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Last 50 webhook deliveries from Meta
          </p>
        </div>

        {/* Webhook stats bar */}
        {typedWebhookDeliveries.length > 0 && (
          <div className="border-b border-gray-100 bg-gray-50 px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <div>
                <span className="font-medium text-gray-700">
                  {successfulWebhooks}
                </span>
                <span className="text-gray-600 ml-1">succeeded</span>
              </div>
              <div>
                <span className="font-medium text-red-600">{failedWebhooks}</span>
                <span className="text-gray-600 ml-1">failed</span>
              </div>
              <div>
                <span className="font-medium text-emerald-600">
                  {webhookSuccessRate}%
                </span>
                <span className="text-gray-600 ml-1">success rate</span>
              </div>
            </div>
          </div>
        )}

        {typedWebhookDeliveries.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Received
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Object Type
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Events
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Dropped
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Signature
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">
                    Error
                  </th>
                </tr>
              </thead>
              <tbody>
                {typedWebhookDeliveries.map((delivery) => (
                  <tr
                    key={delivery.id}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-6 py-3 text-gray-500 text-xs">
                      {new Date(delivery.received_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-3 font-medium text-gray-900">
                      {delivery.object_type}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                          delivery.status === "success"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {delivery.status === "success" ? (
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                        ) : (
                          <AlertCircle className="h-3 w-3 mr-1" />
                        )}
                        {delivery.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      {delivery.normalized_count}
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      {delivery.dropped_count > 0 ? (
                        <span className="text-red-600 font-medium">
                          {delivery.dropped_count}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                          delivery.signature_verified
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {delivery.signature_verified ? "✓ Valid" : "✗ Unverified"}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-red-600 max-w-xs truncate text-xs">
                      {delivery.error || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <RefreshCw className="h-12 w-12 text-blue-500 mx-auto mb-3 opacity-20" />
            <p className="text-gray-600 font-medium">No webhook deliveries</p>
            <p className="text-sm text-gray-500 mt-1">
              No webhook events have been received yet
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
