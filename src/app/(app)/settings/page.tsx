import { createServerSupabase } from "@/lib/supabase/server";
import SettingsForm from "./SettingsForm";
import FaqManager from "./FaqManager";
import type { Settings, FaqEntry } from "@/lib/types";
import { ShieldCheck, ShieldAlert } from "lucide-react";

export default async function SettingsPage() {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  const [settingsResult, faqResult] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", user!.id).single(),
    supabase.from("faq_entries").select("*").eq("user_id", user!.id).order("sort_order"),
  ]);

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

      <SettingsForm settings={settingsResult.data as Settings | null} />

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
