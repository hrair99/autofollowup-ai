"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSettings } from "@/lib/actions";
import { Save, Loader2, Settings2, Bot, Building } from "lucide-react";
import type { Settings } from "@/lib/types";

export default function SettingsForm({ settings }: { settings: Settings | null }) {
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setSaved(false);
    try {
      const formData = new FormData(e.currentTarget);
      await saveSettings(formData);
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      {/* Follow-up Settings */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-gray-400" />
          Follow-up Settings
        </h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="max_follow_ups" className="label">
                Max follow-ups per lead
              </label>
              <input
                id="max_follow_ups"
                name="max_follow_ups"
                type="number"
                min={1}
                max={20}
                defaultValue={settings?.max_follow_ups || 5}
                className="input mt-1"
              />
            </div>
            <div>
              <label htmlFor="follow_up_interval_days" className="label">
                Days between follow-ups
              </label>
              <input
                id="follow_up_interval_days"
                name="follow_up_interval_days"
                type="number"
                min={1}
                max={30}
                defaultValue={settings?.follow_up_interval_days || 3}
                className="input mt-1"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              id="stop_on_reply"
              name="stop_on_reply"
              type="checkbox"
              defaultChecked={settings?.stop_on_reply ?? true}
              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600"
            />
            <label htmlFor="stop_on_reply" className="text-sm text-gray-700">
              Automatically stop follow-ups when a lead replies
            </label>
          </div>
        </div>
      </div>

      {/* AI Settings */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Bot className="h-5 w-5 text-gray-400" />
          AI Message Tone
        </h2>
        <div>
          <label htmlFor="ai_tone" className="label">
            Writing style for generated messages
          </label>
          <select
            id="ai_tone"
            name="ai_tone"
            defaultValue={settings?.ai_tone || "professional"}
            className="input mt-1"
          >
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
            <option value="casual">Casual</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </div>

      {/* Business Info */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Building className="h-5 w-5 text-gray-400" />
          Business Info
        </h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="business_name" className="label">
              Business name
            </label>
            <input
              id="business_name"
              name="business_name"
              defaultValue={settings?.business_name || ""}
              className="input mt-1"
              placeholder="Acme Corp"
            />
          </div>
          <div>
            <label htmlFor="business_description" className="label">
              What does your business do?
            </label>
            <textarea
              id="business_description"
              name="business_description"
              rows={2}
              defaultValue={settings?.business_description || ""}
              className="input mt-1"
              placeholder="We help companies automate their sales outreach..."
            />
          </div>
          <div>
            <label htmlFor="signature" className="label">
              Email signature
            </label>
            <textarea
              id="signature"
              name="signature"
              rows={3}
              defaultValue={settings?.signature || ""}
              className="input mt-1"
              placeholder={"Best regards,\nJohn Doe\nCEO, Acme Corp"}
            />
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save settings
        </button>
        {saved && (
          <span className="text-sm text-green-600 font-medium">Settings saved!</span>
        )}
      </div>
    </form>
  +p;
}
