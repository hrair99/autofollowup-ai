"use client";

import { useState } from "react";
import { Bot, Send, Zap, User, Clock, Tag, ArrowRight, AlertCircle, CheckCircle2 } from "lucide-react";

interface PipelineResult {
  classification: {
    intent: string;
    urgency: string;
    service_type: string | null;
    location_mention: string | null;
    booking_readiness: string;
    pricing_sensitivity: boolean;
    sentiment: string;
    entities: Record<string, unknown>;
    confidence: number;
  } | null;
  next_action: string | null;
  new_stage: string | null;
  sending_link: boolean;
  reply: string;
  error: string | null;
  timings_ms: { classify: number; reply: number; total: number };
}

interface TestReplyResponse {
  input: { message: string; context: string | null };
  pipeline: PipelineResult;
  settings_used: {
    business_name: string;
    ai_tone: string;
    service_type: string;
    enquiry_form_url: string | null;
    first_reply_behaviour: string;
    faq_count: number;
  };
}

const EXAMPLE_MESSAGES = [
  { label: "Quote request", text: "hey how much for a new split system in my living room?" },
  { label: "Urgent repair", text: "my aircon just stopped working and its 38 degrees can you come today??" },
  { label: "Service area check", text: "do you guys service Penrith?" },
  { label: "Greeting", text: "hi there 👋" },
  { label: "Not interested", text: "no thanks we went with someone else" },
  { label: "Booking ready", text: "yes I'd like to book an install please, next Monday works" },
];

export default function TestBotPage() {
  const [message, setMessage] = useState("");
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestReplyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runTest() {
    if (!message.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/test-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, context: context || undefined }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        setError(errBody.error || `HTTP ${res.status}`);
      } else {
        const data: TestReplyResponse = await res.json();
        setResult(data);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Bot className="h-7 w-7 text-brand-600" /> Test Bot
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Simulate a Messenger message through the full AI pipeline — classification, action
            selection, stage transition, and reply generation — without actually sending it.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input column */}
        <div className="space-y-4">
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Quick examples</h2>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_MESSAGES.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  onClick={() => setMessage(ex.text)}
                  className="px-3 py-1.5 text-xs font-medium rounded-full bg-gray-100 hover:bg-brand-50 hover:text-brand-700 text-gray-700 transition"
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Customer message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              className="input-field"
              placeholder="e.g. how much for a ducted install in a 3-bedroom house?"
            />

            <label className="block text-sm font-semibold text-gray-900 mb-2 mt-4">
              Conversation context{" "}
              <span className="font-normal text-gray-500">(optional — prior exchange)</span>
            </label>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={3}
              className="input-field"
              placeholder={'Customer: hi\nBot: Hey! How can we help?'}
            />

            <button
              type="button"
              onClick={runTest}
              disabled={loading || !message.trim()}
              className="btn-primary mt-4 w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Zap className="h-4 w-4 mr-2 animate-pulse" /> Running pipeline...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" /> Run AI pipeline
                </>
              )}
            </button>
          </div>
        </div>

        {/* Output column */}
        <div className="space-y-4">
          {error && (
            <div className="card border-red-200 bg-red-50">
              <div className="flex gap-2 text-red-800">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <div>
                  <h3 className="font-semibold">Error</h3>
                  <p className="text-sm mt-1">{error}</p>
                </div>
              </div>
            </div>
          )}

          {!result && !error && !loading && (
            <div className="card text-center text-sm text-gray-500 py-12">
              <Bot className="h-8 w-8 mx-auto mb-3 text-gray-400" />
              Enter a customer message and click <b>Run AI pipeline</b> to see the bot&apos;s reply,
              along with every classification decision and stage transition.
            </div>
          )}

          {result && (
            <>
              {/* Reply card */}
              <div className="card border-brand-200 bg-brand-50/30">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-brand-600 p-2 shrink-0">
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-gray-900">Bot reply</span>
                      <span className="text-xs text-gray-500">
                        {result.pipeline.timings_ms.total}ms total
                      </span>
                    </div>
                    {result.pipeline.error ? (
                      <p className="text-sm text-red-700">{result.pipeline.error}</p>
                    ) : (
                      <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                        {result.pipeline.reply || "(no reply generated)"}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Classification card */}
              {result.pipeline.classification && (
                <div className="card">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
                    <Tag className="h-4 w-4 text-gray-500" /> Classification
                    <span className="ml-auto text-xs text-gray-500 font-normal">
                      {result.pipeline.timings_ms.classify}ms
                    </span>
                  </h3>
                  <dl className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                    <Field label="Intent" value={result.pipeline.classification.intent} highlight />
                    <Field
                      label="Confidence"
                      value={`${Math.round(result.pipeline.classification.confidence * 100)}%`}
                    />
                    <Field label="Urgency" value={result.pipeline.classification.urgency} />
                    <Field label="Sentiment" value={result.pipeline.classification.sentiment} />
                    <Field
                      label="Booking readiness"
                      value={result.pipeline.classification.booking_readiness}
                    />
                    <Field
                      label="Pricing sensitive"
                      value={result.pipeline.classification.pricing_sensitivity ? "yes" : "no"}
                    />
                    {result.pipeline.classification.service_type && (
                      <Field
                        label="Service type"
                        value={result.pipeline.classification.service_type}
                      />
                    )}
                    {result.pipeline.classification.location_mention && (
                      <Field
                        label="Location"
                        value={result.pipeline.classification.location_mention}
                      />
                    )}
                  </dl>
                  {Object.keys(result.pipeline.classification.entities).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">
                        Entities extracted
                      </div>
                      <pre className="text-xs bg-gray-50 rounded p-2 overflow-x-auto">
                        {JSON.stringify(result.pipeline.classification.entities, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* Decision card */}
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
                  <ArrowRight className="h-4 w-4 text-gray-500" /> Decision
                </h3>
                <dl className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                  <Field label="Next action" value={result.pipeline.next_action as string} highlight />
                  <Field label="Stage → " value={result.pipeline.new_stage as string} />
                  <Field
                    label="Send enquiry link"
                    value={
                      result.pipeline.sending_link ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" /> yes
                        </span>
                      ) : (
                        "no"
                      )
                    }
                  />
                </dl>
              </div>

              {/* Config snapshot */}
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
                  <User className="h-4 w-4 text-gray-500" /> Settings used
                </h3>
                <dl className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                  <Field label="Business" value={result.settings_used.business_name} />
                  <Field label="Tone" value={result.settings_used.ai_tone} />
                  <Field label="Service type" value={result.settings_used.service_type} />
                  <Field
                    label="First-reply"
                    value={result.settings_used.first_reply_behaviour}
                  />
                  <Field
                    label="FAQ entries"
                    value={String(result.settings_used.faq_count)}
                  />
                  <Field
                    label="Has enquiry URL"
                    value={result.settings_used.enquiry_form_url ? "yes" : "no"}
                  />
                </dl>
              </div>

              {/* Timings */}
              <div className="card bg-gray-50">
                <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-gray-500" /> Timings
                </h3>
                <div className="flex gap-4 text-xs text-gray-600">
                  <span>
                    Classify: <b>{result.pipeline.timings_ms.classify}ms</b>
                  </span>
                  <span>
                    Reply: <b>{result.pipeline.timings_ms.reply}ms</b>
                  </span>
                  <span>
                    Total: <b>{result.pipeline.timings_ms.total}ms</b>
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <>
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</dt>
      <dd
        className={
          highlight
            ? "text-sm font-semibold text-brand-700"
            : "text-sm text-gray-900"
        }
      >
        {value}
      </dd>
    </>
  );
}
