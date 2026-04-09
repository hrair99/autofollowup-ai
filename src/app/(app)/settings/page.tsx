import { createServerSupabase } from "@/lib/supabase/server";
import SettingsForm from "./SettingsForm";
import type { Settings } from "@/lib/types";

export default async function SettingsPage() {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: settings } = await supabase
    .from("settings")
    .select("*")
    .eq("user_id", user!.id)
    .single();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure your follow-up automation and AI behavior
        </p>
      </div>

      <SettingsForm settings={settings as Settings | null} />
    </div>
  );
}
