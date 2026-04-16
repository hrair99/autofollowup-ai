"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Props {
  businessId: string;
  businessName: string;
  hasToken: boolean;
  connectedPages: Array<{ page_id: string; page_name: string; is_active: boolean }>;
  currentStep: string;
  mode: string;
}

const STEPS = [
  { key: "connect_facebook", label: "Connect Facebook", number: 1 },
  { key: "select_page", label: "Select Page", number: 2 },
  { key: "preview_replies", label: "Preview Replies", number: 3 },
  { key: "enable_automation", label: "Go Live", number: 4 },
];

const SAMPLE_COMMENTS = [
  "How much for a split system installed?",
  "Do you guys service the Gold Coast area?",
  "Need a plumber ASAP, burst pipe flooding my kitchen!",
  "Can someone come out this week for a quote?",
  "Interested! Can you DM me more info?",
];

export default function OnboardingFlow({
  businessId,
  businessName,
  hasToken,
  connectedPages,
  currentStep,
  mode,
}: Props) {
  const router = useRouter();

  // Determine initial step based on state
  const getInitialStep = () => {
    if (!hasToken) return 0;
    if (connectedPages.length === 0) return 1;
    if (currentStep === "preview_replies") return 2;
    if (currentStep === "enable_automation") return 3;
    return 0;
  };

  const [step, setStep] = useState(getInitialStep());
  const [testComment, setTestComment] = useState("");
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [enabling, setEnabling] = useState(false);

  // Step 1: Connect Facebook
  const handleConnectFacebook = () => {
    window.location.href = `/api/connect/facebook?business_id=${businessId}`;
  };

  // Step 3: Test a comment
  const handleTestComment = useCallback(async (comment: string) => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/onboarding/test-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ error: "Failed to generate preview" });
    }
    setTesting(false);
  }, []);

  // Step 4: Enable automation
  const handleEnableAutomation = async () => {
    setEnabling(true);
    try {
      // Set mode to active
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "active" }),
      });

      // Mark onboarding complete
      await fetch("/api/onboarding/complete", {
        method: "POST",
      }).catch(() => {});

      router.push("/dashboard");
    } catch {
      setEnabling(false);
    }
  };

  // Update step on Supabase
  const advanceStep = async (nextStep: number) => {
    setStep(nextStep);
    const stepKey = STEPS[nextStep]?.key || "enable_automation";
    await fetch("/api/onboarding/step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: stepKey }),
    }).catch(() => {});
  };

  return (
    <div>
      {/* Step indicators */}
      <div className="flex items-center justify-between mb-10">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                i < step
                  ? "bg-green-500 text-white"
                  : i === step
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 text-gray-500"
              }`}
            >
              {i < step ? "✓" : s.number}
            </div>
            <span
              className={`ml-2 text-sm hidden sm:inline ${
                i === step ? "font-semibold text-gray-900" : "text-gray-500"
              }`}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <div
                className={`mx-3 h-0.5 w-8 sm:w-16 ${
                  i < step ? "bg-green-500" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        {/* STEP 1: Connect Facebook */}
        {step === 0 && (
          <div>
            <h2 className="text-xl font-bold mb-2">Connect your Facebook account</h2>
            <p className="text-gray-600 mb-1">
              This lets us monitor comments on your business page and reply automatically.
            </p>
            <p className="text-sm text-gray-400 mb-6">
              We only read and reply to comments — we never post on your behalf.
            </p>
            {hasToken ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded">
                  <span className="text-lg">✓</span>
                  <span className="font-medium">Facebook connected</span>
                </div>
                <button
                  onClick={() => advanceStep(1)}
                  className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
                >
                  Next: Select your page →
                </button>
              </div>
            ) : (
              <button
                onClick={handleConnectFacebook}
                className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
                Connect with Facebook
              </button>
            )}
          </div>
        )}

        {/* STEP 2: Select Page */}
        {step === 1 && (
          <div>
            <h2 className="text-xl font-bold mb-2">Select your business page</h2>
            <p className="text-gray-600 mb-6">
              Choose which Facebook page you want us to monitor for leads.
            </p>
            {connectedPages.length > 0 ? (
              <div className="space-y-4">
                {connectedPages.map((page) => (
                  <div
                    key={page.page_id}
                    className="flex items-center justify-between p-3 border rounded-lg bg-green-50 border-green-200"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-green-500">●</span>
                      <span className="font-medium">{page.page_name}</span>
                    </div>
                    <span className="text-sm text-green-600">Connected</span>
                  </div>
                ))}
                <button
                  onClick={() => advanceStep(2)}
                  className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
                >
                  Next: Preview how replies work →
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-amber-600 bg-amber-50 p-3 rounded text-sm">
                  No pages connected yet. Go to the Connect Page to select your business page.
                </p>
                <button
                  onClick={() => (window.location.href = "/connect")}
                  className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
                >
                  Select a page →
                </button>
              </div>
            )}
          </div>
        )}

        {/* STEP 3: Preview Replies */}
        {step === 2 && (
          <div>
            <h2 className="text-xl font-bold mb-2">See how it works</h2>
            <p className="text-gray-600 mb-2">
              Type a comment like a customer would — or try one of the examples below.
              You&apos;ll see exactly what the system would reply.
            </p>
            <p className="text-xs text-gray-400 mb-4">
              Nothing gets posted. This is just a preview.
            </p>

            {/* Sample comments */}
            <div className="flex flex-wrap gap-2 mb-4">
              {SAMPLE_COMMENTS.map((sample) => (
                <button
                  key={sample}
                  onClick={() => {
                    setTestComment(sample);
                    handleTestComment(sample);
                  }}
                  className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-blue-50 hover:text-blue-700 rounded-full border text-gray-600 transition-colors"
                >
                  {sample.length > 40 ? sample.slice(0, 40) + "..." : sample}
                </button>
              ))}
            </div>

            {/* Custom input */}
            <div className="flex gap-2 mb-6">
              <input
                type="text"
                value={testComment}
                onChange={(e) => setTestComment(e.target.value)}
                placeholder="Type a sample comment..."
                className="flex-1 border rounded-lg px-4 py-2 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && testComment.trim()) {
                    handleTestComment(testComment);
                  }
                }}
              />
              <button
                onClick={() => handleTestComment(testComment)}
                disabled={!testComment.trim() || testing}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {testing ? "..." : "Test"}
              </button>
            </div>

            {/* Results */}
            {testResult && !testResult.error && (
              <div className="space-y-4 border-t pt-4">
                {/* Classification */}
                <div className="bg-gray-50 p-3 rounded">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-500 uppercase">
                      What we detected
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        testResult.classification.isLead
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {testResult.classification.isLead ? "Lead Signal" : "Not a Lead"}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700">
                    <span className="font-medium capitalize">
                      {testResult.classification.type.replace(/_/g, " ")}
                    </span>
                    {" · "}
                    <span className="text-gray-500">
                      {Math.round(testResult.classification.confidence * 100)}% confidence
                    </span>
                  </p>
                  {testResult.entities && Object.keys(testResult.entities).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {Object.entries(testResult.entities).map(([key, val]) =>
                        val ? (
                          <span
                            key={key}
                            className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded"
                          >
                            {key}: {String(val)}
                          </span>
                        ) : null
                      )}
                    </div>
                  )}
                </div>

                {/* Public reply */}
                <div className="bg-blue-50 p-3 rounded">
                  <span className="text-xs font-medium text-blue-600 uppercase block mb-1">
                    Public Reply (posted on your page)
                  </span>
                  <p className="text-sm text-gray-800">{testResult.publicReply}</p>
                </div>

                {/* DM preview */}
                <div className="bg-purple-50 p-3 rounded">
                  <span className="text-xs font-medium text-purple-600 uppercase block mb-1">
                    Private Message (sent via Messenger)
                  </span>
                  <p className="text-sm text-gray-800 whitespace-pre-line">
                    {testResult.dmPreview}
                  </p>
                </div>

                {/* Confidence tier indicator */}
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      testResult.confidenceTier === "high"
                        ? "bg-green-500"
                        : testResult.confidenceTier === "safe"
                        ? "bg-yellow-500"
                        : "bg-red-500"
                    }`}
                  />
                  {testResult.wouldAutoReply
                    ? "This comment would get an automatic reply"
                    : "This comment would be logged but not auto-replied (low confidence)"}
                </div>
              </div>
            )}

            {testResult?.error && (
              <p className="text-sm text-red-600 bg-red-50 p-3 rounded">
                {testResult.error}
              </p>
            )}

            <button
              onClick={() => advanceStep(3)}
              className="w-full mt-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
            >
              Looks good — let&apos;s go live →
            </button>
          </div>
        )}

        {/* STEP 4: Enable Automation */}
        {step === 3 && (
          <div>
            <h2 className="text-xl font-bold mb-2">Ready to go live</h2>
            <p className="text-gray-600 mb-6">
              When you enable automation, the system will automatically monitor your
              Facebook page, classify comments, and reply to potential leads.
            </p>

            <div className="space-y-3 mb-6">
              <div className="flex items-start gap-3 p-3 bg-green-50 rounded">
                <span className="text-green-500 mt-0.5">✓</span>
                <div>
                  <p className="font-medium text-sm">Auto-reply to leads</p>
                  <p className="text-xs text-gray-500">
                    High-confidence comments get a public reply + private message
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-green-50 rounded">
                <span className="text-green-500 mt-0.5">✓</span>
                <div>
                  <p className="font-medium text-sm">Lead tracking</p>
                  <p className="text-xs text-gray-500">
                    Every potential customer is logged and scored
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-green-50 rounded">
                <span className="text-green-500 mt-0.5">✓</span>
                <div>
                  <p className="font-medium text-sm">Safe mode</p>
                  <p className="text-xs text-gray-500">
                    Low-confidence comments are flagged, not auto-replied
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  // Start in monitor mode first
                  router.push("/dashboard");
                }}
                className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50"
              >
                Start in monitor mode
              </button>
              <button
                onClick={handleEnableAutomation}
                disabled={enabling}
                className="flex-1 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {enabling ? "Enabling..." : "Enable automation →"}
              </button>
            </div>
            <p className="text-xs text-gray-400 text-center mt-3">
              Monitor mode logs everything but doesn&apos;t reply. You can switch anytime.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
