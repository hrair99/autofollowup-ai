"use client";

import { useState, useEffect } from "react";

// ─── Automation Toggle ───────────────────────────────────────────────
interface AutomationToggleProps {
  initialMode: string;
  hasConnectedPage: boolean;
  onboardingCompleted: boolean;
}

export function AutomationToggle({
  initialMode,
  hasConnectedPage,
  onboardingCompleted,
}: AutomationToggleProps) {
  const [mode, setMode] = useState(initialMode);
  const [switching, setSwitching] = useState(false);

  const needsSetup = !hasConnectedPage || !onboardingCompleted;
  const isActive = mode === "active";

  const statusLabel = needsSetup
    ? "Needs Setup"
    : isActive
    ? "Active"
    : "Paused";

  const statusColor = needsSetup
    ? "bg-yellow-100 text-yellow-800"
    : isActive
    ? "bg-green-100 text-green-700"
    : "bg-gray-100 text-gray-600";

  const handleToggle = async () => {
    if (needsSetup) {
      window.location.href = "/onboarding";
      return;
    }
    setSwitching(true);
    const newMode = isActive ? "monitor" : "active";
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });
      if (res.ok) setMode(newMode);
    } catch {
      // ignore
    }
    setSwitching(false);
  };

  return (
    <div className="bg-white rounded-lg border p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div
          className={`w-3 h-3 rounded-full ${
            needsSetup
              ? "bg-yellow-400"
              : isActive
              ? "bg-green-500 animate-pulse"
              : "bg-gray-400"
          }`}
        />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">Automation</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor}`}
            >
              {statusLabel}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {needsSetup
              ? "Complete setup to enable automation"
              : isActive
              ? "Automatically replying to leads on your page"
              : "Monitoring comments but not replying"}
          </p>
        </div>
      </div>
      <button
        onClick={handleToggle}
        disabled={switching}
        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${
          needsSetup
            ? "bg-yellow-300 cursor-pointer"
            : isActive
            ? "bg-green-500"
            : "bg-gray-300"
        } disabled:opacity-50`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            isActive && !needsSetup ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

// ─── ROI Display ─────────────────────────────────────────────────────
export function RoiDisplay() {
  const [roi, setRoi] = useState<{
    current: { totalLeads: number; hotLeads: number; warmLeads: number; coldLeads: number; estimatedTotalRevenue: number };
    monthOverMonth: { leadGrowth: number | null; revenueGrowth: number | null };
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/roi")
      .then((r) => r.json())
      .then((data) => {
        if (data.current) setRoi(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-lg border p-4 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
        <div className="h-8 bg-gray-200 rounded w-1/2" />
      </div>
    );
  }

  if (!roi || !roi.current) return null;

  const { current, monthOverMonth } = roi;
  const revenue = current.estimatedTotalRevenue;
  const leads = current.totalLeads;

  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-500">Lead Value (this month)</span>
        {monthOverMonth.revenueGrowth !== null && (
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              monthOverMonth.revenueGrowth >= 0
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {monthOverMonth.revenueGrowth >= 0 ? "+" : ""}
            {monthOverMonth.revenueGrowth}% vs last month
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-gray-900">
          ${revenue.toLocaleString()}
        </span>
        <span className="text-sm text-gray-500">estimated value</span>
      </div>
      <div className="flex gap-4 mt-3">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-xs text-gray-600">
            {current.hotLeads} hot
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-yellow-500" />
          <span className="text-xs text-gray-600">
            {current.warmLeads} warm
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-gray-400" />
          <span className="text-xs text-gray-600">
            {current.coldLeads} cold
          </span>
        </div>
        <span className="text-xs text-gray-400 ml-auto">
          {leads} total leads
        </span>
      </div>
    </div>
  );
}

// ─── Alerts Panel ────────────────────────────────────────────────────
interface Alert {
  id: string;
  type: string;
  severity: string;
  message: string;
  created_at: string;
}

export function AlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/alerts")
      .then((r) => r.json())
      .then((data) => {
        if (data.alerts) setAlerts(data.alerts);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleDismiss = async (alertId: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    await fetch("/api/dashboard/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId }),
    }).catch(() => {});
  };

  const handleDismissAll = async () => {
    setAlerts([]);
    await fetch("/api/dashboard/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledgeAll: true }),
    }).catch(() => {});
  };

  if (loading) return null;
  if (alerts.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">Alerts</span>
          <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
            {alerts.length}
          </span>
        </div>
        <button
          onClick={handleDismissAll}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Dismiss all
        </button>
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`flex items-start justify-between gap-2 text-sm p-2 rounded ${
              alert.severity === "critical"
                ? "bg-red-50 text-red-800"
                : alert.severity === "warning"
                ? "bg-yellow-50 text-yellow-800"
                : "bg-blue-50 text-blue-800"
            }`}
          >
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium uppercase opacity-70">
                {alert.type.replace(/_/g, " ")}
              </span>
              <p className="text-sm truncate">{alert.message}</p>
            </div>
            <button
              onClick={() => handleDismiss(alert.id)}
              className="text-xs opacity-50 hover:opacity-100 shrink-0"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
