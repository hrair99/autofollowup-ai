"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";

interface ConnectedPage {
  page_id: string;
  page_name: string;
  is_active: boolean;
  token_status: string;
}

interface MetaPage {
  id: string;
  name: string;
  category: string | null;
  connected: boolean;
  active: boolean;
}

interface Props {
  hasToken: boolean;
  connectedPages: ConnectedPage[];
  businessId: string;
}

export default function ConnectFlow({
  hasToken,
  connectedPages,
  businessId,
}: Props) {
  const searchParams = useSearchParams();
  const step = searchParams.get("step");
  const error = searchParams.get("error");

  const [availablePages, setAvailablePages] = useState<MetaPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const fetchPages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/connect/pages");
      const data = await res.json();
      if (res.ok && data.pages) {
        setAvailablePages(data.pages);
      } else {
        setMessage({
          type: "error",
          text: data.message || "Failed to load pages",
        });
      }
    } catch {
      setMessage({ type: "error", text: "Network error loading pages" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (step === "select_pages" && hasToken) {
      fetchPages();
    }
  }, [step, hasToken, fetchPages]);

  const activatePage = async (pageId: string, pageName: string) => {
    setActivating(pageId);
    setMessage(null);
    try {
      const res = await fetch("/api/connect/pages/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, pageName }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessage({
          type: "success",
          text: `${pageName} connected successfully! Webhooks subscribed.`,
        });
        // Update the page in list
        setAvailablePages((prev) =>
          prev.map((p) =>
            p.id === pageId ? { ...p, connected: true, active: true } : p
          )
        );
      } else {
        setMessage({
          type: "error",
          text: data.message || "Failed to activate page",
        });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    } finally {
      setActivating(null);
    }
  };

  const disconnectPage = async (pageId: string) => {
    setActivating(pageId);
    try {
      const res = await fetch("/api/connect/pages/activate", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "Page disconnected." });
        setAvailablePages((prev) =>
          prev.map((p) =>
            p.id === pageId ? { ...p, connected: false, active: false } : p
          )
        );
      }
    } catch {
      setMessage({ type: "error", text: "Failed to disconnect" });
    } finally {
      setActivating(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Error from OAuth redirect */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            Connection failed:{" "}
            {error === "oauth_denied"
              ? "You declined the permissions. Please try again and accept all permissions."
              : error === "token_expired"
                ? "Your Facebook token has expired. Please reconnect."
                : error}
          </p>
        </div>
      )}

      {/* Success/error messages */}
      {message && (
        <div
          className={`rounded-lg border p-4 ${
            message.type === "success"
              ? "border-green-200 bg-green-50"
              : "border-red-200 bg-red-50"
          }`}
        >
          <p
            className={`text-sm font-medium ${
              message.type === "success" ? "text-green-800" : "text-red-800"
            }`}
          >
            {message.text}
          </p>
        </div>
      )}

      {/* Currently connected pages */}
      {connectedPages.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Connected Pages
          </h2>
          <div className="space-y-3">
            {connectedPages.map((page) => (
              <div
                key={page.page_id}
                className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`h-3 w-3 rounded-full ${
                      page.is_active && page.token_status === "valid"
                        ? "bg-green-500"
                        : page.token_status === "expired" ||
                            page.token_status === "invalid"
                          ? "bg-red-500"
                          : "bg-yellow-500"
                    }`}
                  />
                  <div>
                    <p className="font-medium text-gray-900">
                      {page.page_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      ID: {page.page_id} · Token:{" "}
                      {page.token_status || "unknown"}
                    </p>
                  </div>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    page.is_active
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {page.is_active ? "Active" : "Inactive"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 1: Connect Facebook Account */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          {hasToken ? "1. Facebook Account Connected ✓" : "1. Connect Facebook Account"}
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          {hasToken
            ? "Your Facebook account is connected. You can reconnect to refresh permissions."
            : "Sign in with Facebook to grant AutoFollowUp access to manage your pages."}
        </p>

        <a
          href="/api/connect/facebook"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
          </svg>
          {hasToken ? "Reconnect Facebook" : "Connect with Facebook"}
        </a>
      </div>

      {/* Step 2: Select Pages */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          2. Select Pages to Manage
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Choose which Facebook pages AutoFollowUp should monitor and respond to.
        </p>

        {!hasToken && step !== "select_pages" && (
          <p className="text-sm text-gray-400 italic">
            Connect your Facebook account first to see your pages.
          </p>
        )}

        {hasToken && step !== "select_pages" && (
          <button
            onClick={fetchPages}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load My Pages"}
          </button>
        )}

        {loading && (
          <div className="flex items-center gap-2 mt-4">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-900 border-t-transparent" />
            <span className="text-sm text-gray-500">
              Fetching pages from Facebook...
            </span>
          </div>
        )}

        {availablePages.length > 0 && (
          <div className="mt-4 space-y-3">
            {availablePages.map((page) => (
              <div
                key={page.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors"
              >
                <div>
                  <p className="font-medium text-gray-900">{page.name}</p>
                  <p className="text-xs text-gray-500">
                    {page.category || "Page"} · ID: {page.id}
                  </p>
                </div>
                {page.active ? (
                  <button
                    onClick={() => disconnectPage(page.id)}
                    disabled={activating === page.id}
                    className="inline-flex items-center rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {activating === page.id ? "..." : "Disconnect"}
                  </button>
                ) : (
                  <button
                    onClick={() => activatePage(page.id, page.name)}
                    disabled={activating === page.id}
                    className="inline-flex items-center rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {activating === page.id ? "Connecting..." : "Connect Page"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Connection Health */}
      {hasToken && <ConnectionHealth />}

      {/* Info box */}
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
        <h3 className="text-sm font-medium text-blue-800 mb-1">
          Permissions Required
        </h3>
        <p className="text-xs text-blue-700">
          AutoFollowUp needs these Facebook permissions: page management, messaging,
          comment reading &amp; replying, and lead retrieval. All data stays in your
          account — we never post without your automation rules being active.
          New pages start in <strong>Monitor Mode</strong> (read-only) until you
          activate them.
        </p>
      </div>
    </div>
  );
}

// ============================================
// Connection Health Panel
// ============================================

interface HealthData {
  hasUserToken: boolean;
  tokenDebugInfo: { isValid: boolean; expiresAt: string | null; scopes: string[] } | null;
  pages: Array<{
    pageId: string;
    pageName: string;
    tokenValid: boolean;
    webhookSubscribed: boolean;
    permissions: Array<{ permission: string; label: string; granted: boolean; required: boolean }>;
    tokenExpiresAt: string | null;
  }>;
}

function ConnectionHealth() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const checkHealth = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/connect/health");
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
        setExpanded(true);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const formatExpiry = (iso: string | null) => {
    if (!iso) return "Never expires";
    const d = new Date(iso);
    const now = new Date();
    const daysLeft = Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) return "Expired";
    if (daysLeft < 7) return `Expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""} ⚠️`;
    return `Expires ${d.toLocaleDateString()}`;
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-gray-900">Connection Health</h2>
        <button
          onClick={checkHealth}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50"
        >
          {loading ? "Checking..." : "Run Health Check"}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Verify your token, permissions, and webhook subscriptions are working correctly.
      </p>

      {health && expanded && (
        <div className="space-y-4">
          {/* User Token Status */}
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`h-2.5 w-2.5 rounded-full ${
                health.tokenDebugInfo?.isValid ? "bg-green-500" : "bg-red-500"
              }`} />
              <span className="text-sm font-medium text-gray-900">
                User Token: {health.tokenDebugInfo?.isValid ? "Valid" : "Invalid"}
              </span>
            </div>
            {health.tokenDebugInfo && (
              <div className="text-xs text-gray-500 space-y-1">
                <p>{formatExpiry(health.tokenDebugInfo.expiresAt)}</p>
                <p>Scopes: {health.tokenDebugInfo.scopes.length} granted</p>
              </div>
            )}
          </div>

          {/* Per-page health */}
          {health.pages.map((page) => (
            <div key={page.pageId} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">{page.pageName}</h3>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <div className={`h-2.5 w-2.5 rounded-full ${page.tokenValid ? "bg-green-500" : "bg-red-500"}`} />
                  <span className="text-xs text-gray-600">
                    Page Token: {page.tokenValid ? "Valid" : "Invalid"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`h-2.5 w-2.5 rounded-full ${page.webhookSubscribed ? "bg-green-500" : "bg-red-500"}`} />
                  <span className="text-xs text-gray-600">
                    Webhooks: {page.webhookSubscribed ? "Subscribed" : "Not subscribed"}
                  </span>
                </div>
              </div>

              {page.tokenExpiresAt && (
                <p className="text-xs text-gray-500 mb-3">{formatExpiry(page.tokenExpiresAt)}</p>
              )}

              {/* Permissions checklist */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-700 mb-1">Permissions</p>
                {page.permissions.map((perm) => (
                  <div key={perm.permission} className="flex items-center gap-2 text-xs">
                    <span className={perm.granted ? "text-green-500" : perm.required ? "text-red-500" : "text-gray-400"}>
                      {perm.granted ? "✓" : perm.required ? "✗" : "○"}
                    </span>
                    <span className={perm.granted ? "text-gray-600" : perm.required ? "text-red-600" : "text-gray-400"}>
                      {perm.label}
                      {perm.required && !perm.granted && " (required)"}
                      {!perm.required && !perm.granted && " (optional)"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {health.pages.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-4">
              No pages connected yet. Connect a page above to see its health status.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
