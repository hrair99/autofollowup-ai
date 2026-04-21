import { createServerSupabase } from "@/lib/supabase/server";
import SettingsForm from "./SettingsForm";
import FaqManager from "./FaqManager";
import type { Settings, FaqEntry } from "@/lib/types";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { getBusinessConfig } from "@/lib/business/config";
import { getUserBusinessId } from "@/lib/business/resolve";

export default async function SettingsPage() {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  const [settingsResult, faqResult] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", user!.id).single(),
    supabase.from("faq_entries").select("*").eq("user_id", user!.id).order("sort_order"),
  ]);

  // Load business config for handoff + scoring settings
  let configExtras: Partial<Settings> = {};
  const businessId = await getUserBusinessId(user!.id);
  if (businessId) {
    try {
      const config = await getBusinessConfig(businessId);
      configExtras = {
        handoff_auto_expire_hours: config.handoff.auto_expire_hours,
        handoff_low_confidence_threshold: config.handoff.low_confidence_threshold,
        // Scoring weights from raw config
        scoring_classification: (config.raw["scoring.weights"] as Record<string, number>)?.classification ?? 1.0,
        scoring_engagement: (config.raw["scoring.weights"] as Record<string, number>)?.engagement ?? 1.0,
        scoring_urgency: (config.raw["scoring.weights"] as Record<string, number>)?.urgency ?? 1.0,
        scoring_recency: (config.raw["scoring.weights"] as Record<string, number>)?.recency ?? 1.0,
        scoring_intent: (config.raw["scoring.weights"] as Record<string, number>)?.intent ?? 1.0,
        scoring_response_time: (config.raw["scoring.weights"] as Record<string, number>)?.response_time ?? 0.8,
        scoring_source: (config.raw["scoring.weights"] as Record<string, number>)?.source ?? 0.5,
      };

      // Load estimated_lead_value from businesses table
      const { data: biz } = await supabase
        .from("businesses")
        .select("estimated_lead_value")
        .eq("id", businessId)
        .single();
      if (biz?.estimated_lead_value) {
        configExtras.estimated_lead_value = biz.estimated_lead_value;
      }
    } catch {
      // Config not available yet, use defaults
    }
  }

  // Server-side env checks so we can render health badges without
  // exposing secret values to the client.
  const webhookSecure = !!process.env.META_APP_SECRET;
  const signatureBypassed = process.env.META_SKIP_SIGNATURE_CHECK === "true";
  const groqConfigured = !!process.env.GROQ_API_KEY;
  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure your business info, AI behaviour, follow-ups, and comment automation.
        </p>
      </div>

      {/* System health banner */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <HealthCard
          ok={webhookSecure && !signatureBypassed}
          warn={signatureBypassed}
          label="Webhook signature"
          okText="Verifying Meta HMAC"
          warnText="Signature check BYPASSED (dev mode)"
          failText="META_APP_SECRET not set"
        />
        <HealthCard
          ok={groqConfigured}
          label="Groq AI"
          okText="Connected"
          failText="GROQ_API_KEY missing"
        />
        <HealthCard
          ok={supabaseConfigured}
          label="Supabase"
          okText="Connected"
          failText="Supabase env vars missing"
        />
      </div>

      <SettingsForm settings={settingsResult.data ? { ...(settingsResult.data as Settings), ...configExtras } : null} />

      <div className="mt-10 border-t pt-8">
        <FaqManager entries={(faqResult.data || []) as FaqEntry[]} />
      </div>
    </div>
  );
}

function HealthCard({
  ok,
  warn,
  label,
  okText,
  warnText,
  failText,
}: {
  ok: boolean;
  warn?: boolean;
  label: string;
  okText: string;
  warnText?: string;
  failText: string;
}) {
  const tone = warn ? "amber" : ok ? "emerald" : "red";
  const classes: Record<string, string> = {
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
    amber: "bg-amber-50 border-amber-200 text-amber-800",
    red: "bg-red-50 border-red-200 text-red-800",
  };
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm flex items-center gap-2 ${classes[tone]}`}
    >
      {ok && !warn ? (
        <ShieldCheck className="h-4 w-4 flex-shrink-0" />
      ) : (
        <ShieldAlert className="h-4 w-4 flex-shrink-0" />
      )}
      <div className="min-w-0">
        <p className="font-medium leading-tight">{label}</p>
        <p className="text-xs leading-tight">
          {warn ? warnText : ok ? okText : failText}
        </p>
      </div>
    </div>
  );
}
