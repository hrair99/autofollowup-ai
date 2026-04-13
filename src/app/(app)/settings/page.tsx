import { createServerSupabase } from "@/lib/supabase/server";
import SettingsForm from "./SettingsForm";
import FaqManager from "./FaqManager";
import type { Settings, FaqEntry } from "@/lib/types";

export default async function SettingsPage() {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  const [settingsResult, faqResult] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", user!.id).single(),
    supabase.from("faq_entries").select("*").eq("user_id", user!.id).order("sort_order"),
  ]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure your business info, AI behaviour, follow-ups, and comment automation.
        </p>
      </div>

      <SettingsForm settings={settingsResult.data as Settings | null} />

      <div className="mt-10 border-t pt-8">
        <FaqManager entries={(faqResult.data || []) as FaqEntry[]} />
      </div>
    </div>
  
 "