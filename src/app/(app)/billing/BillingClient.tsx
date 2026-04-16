"use client";

import { useState } from "react";

interface Props {
  plan: string;
  subscriptionStatus: string;
  hasStripeCustomer: boolean;
  usage: { comments: number; dms: number; aiCalls: number };
}

const PLANS = [
  {
    key: "starter",
    name: "Starter",
    price: "$97",
    period: "/month",
    limits: { comments: 300, dms: 200 },
    features: [
      "300 comments/month",
      "200 DMs/month",
      "Up to 2 pages",
      "AI-powered replies",
      "Lead tracking",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    price: "$149",
    period: "/month",
    limits: { comments: 2000, dms: 1500 },
    features: [
      "2,000 comments/month",
      "1,500 DMs/month",
      "Up to 5 pages",
      "Priority support",
      "Advanced lead scoring",
    ],
    popular: true,
  },
];

export default function BillingClient({ plan, subscriptionStatus, hasStripeCustomer, usage }: Props) {
  const [loading, setLoading] = useState<string | null>(null);

  const handleUpgrade = async (planKey: string) => {
    setLoading(planKey);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || "Failed to start checkout");
      }
    } catch {
      alert("Something went wrong");
    }
    setLoading(null);
  };

  const handleManageBilling = async () => {
    setLoading("portal");
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || "Failed to open billing portal");
      }
    } catch {
      alert("Something went wrong");
    }
    setLoading(null);
  };

  const isActive = subscriptionStatus === "active" || subscriptionStatus === "trialing";
  const currentPlanObj = PLANS.find((p) => p.key === plan);
  const commentLimit = currentPlanObj?.limits.comments || 50;
  const dmLimit = currentPlanObj?.limits.dms || 30;

  return (
    <div className="space-y-8">
      {/* Current plan status */}
      <div className="bg-white rounded-lg border p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Current Plan</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-2xl font-bold capitalize">{plan}</span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  isActive
                    ? "bg-green-100 text-green-700"
                    : subscriptionStatus === "past_due"
                    ? "bg-yellow-100 text-yellow-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {isActive ? "Active" : subscriptionStatus === "past_due" ? "Past Due" : plan === "free" ? "Free" : "Inactive"}
              </span>
            </div>
          </div>
          {hasStripeCustomer && (
            <button
              onClick={handleManageBilling}
              disabled={loading === "portal"}
              className="text-sm text-blue-600 hover:underline disabled:opacity-50"
            >
              {loading === "portal" ? "Opening..." : "Manage billing →"}
            </button>
          )}
        </div>

        {/* Usage bars */}
        <div className="space-y-3">
          <UsageBar label="Comments" current={usage.comments} limit={plan === "free" ? 50 : commentLimit} />
          <UsageBar label="DMs" current={usage.dms} limit={plan === "free" ? 30 : dmLimit} />
        </div>
      </div>

      {/* Plan cards */}
      {(plan === "free" || plan === "starter") && (
        <div>
          <h2 className="text-lg font-semibold mb-4">
            {plan === "free" ? "Choose a plan" : "Upgrade"}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PLANS.filter((p) => p.key !== plan).map((p) => (
              <div
                key={p.key}
                className={`bg-white rounded-lg border p-6 ${
                  p.popular ? "border-blue-500 ring-1 ring-blue-500" : ""
                }`}
              >
                {p.popular && (
                  <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full font-medium mb-3 inline-block">
                    Most popular
                  </span>
                )}
                <h3 className="text-xl font-bold">{p.name}</h3>
                <div className="mt-1 mb-4">
                  <span className="text-3xl font-bold">{p.price}</span>
                  <span className="text-gray-500">{p.period}</span>
                </div>
                <ul className="space-y-2 mb-6">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="text-green-500">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => handleUpgrade(p.key)}
                  disabled={loading === p.key}
                  className={`w-full py-2.5 rounded-lg font-medium ${
                    p.popular
                      ? "bg-blue-600 text-white hover:bg-blue-700"
                      : "bg-gray-900 text-white hover:bg-gray-800"
                  } disabled:opacity-50`}
                >
                  {loading === p.key ? "Loading..." : `Upgrade to ${p.name}`}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UsageBar({ label, current, limit }: { label: string; current: number; limit: number }) {
  const pct = limit === -1 ? 0 : Math.min(100, Math.round((current / limit) * 100));
  const isNearLimit = pct >= 80;
  const isOver = pct >= 100;

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className={isOver ? "text-red-600 font-medium" : isNearLimit ? "text-amber-600" : "text-gray-500"}>
          {current.toLocaleString()} / {limit === -1 ? "∞" : limit.toLocaleString()}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isOver ? "bg-red-500" : isNearLimit ? "bg-amber-500" : "bg-blue-500"
          }`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}
