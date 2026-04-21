"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSettings } from "@/lib/actions";
import { Save, Loader2, Settings2, Bot, Building, MessageSquare, Shield, Globe, Phone, ArrowRightLeft, BarChart3 } from "lucide-react";
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

      {/* Business Info */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Building className="h-5 w-5 text-gray-400" />
          Business Information
        </h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="business_name" className="label">Business name</label>
              <input id="business_name" name="business_name" defaultValue={settings?.business_name || ""} className="input mt-1" placeholder="HR AIR" />
            </div>
            <div>
              <label htmlFor="service_type" className="label">Service type</label>
              <input id="service_type" name="service_type" defaultValue={settings?.service_type || ""} className="input mt-1" placeholder="HVAC / Air Conditioning" />
            </div>
          </div>
          <div>
            <label htmlFor="business_description" className="label">Business description</label>
            <textarea id="business_description" name="business_description" rows={2} defaultValue={settings?.business_description || ""} className="input mt-1" placeholder="HVAC company providing air conditioning installation, repairs, and servicing..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="contact_email" className="label">Contact email</label>
              <input id="contact_email" name="contact_email" type="email" defaultValue={settings?.contact_email || ""} className="input mt-1" placeholder="info@yourbusiness.com.au" />
            </div>
            <div>
              <label htmlFor="contact_phone" className="label">Contact phone</label>
              <input id="contact_phone" name="contact_phone" defaultValue={settings?.contact_phone || ""} className="input mt-1" placeholder="0400 000 000" />
            </div>
          </div>
          <div>
            <label htmlFor="service_areas" className="label">Service areas / suburbs (comma-separated)</label>
            <input id="service_areas" name="service_areas" defaultValue={settings?.service_areas?.join(", ") || ""} className="input mt-1" placeholder="Newcastle, Maitland, Lake Macquarie, Hunter Valley" />
          </div>
          <div>
            <label htmlFor="service_categories" className="label">Service categories (comma-separated)</label>
            <input id="service_categories" name="service_categories" defaultValue={settings?.service_categories?.join(", ") || ""} className="input mt-1" placeholder="installation, repairs, maintenance, split systems, ducted systems" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="callout_fee" className="label">Call-out fee</label>
              <input id="callout_fee" name="callout_fee" defaultValue={settings?.callout_fee || ""} className="input mt-1" placeholder="e.g. $99 + GST" />
            </div>
            <div>
              <label htmlFor="operating_hours" className="label">Operating hours</label>
              <input id="operating_hours" name="operating_hours" defaultValue={settings?.operating_hours || ""} className="input mt-1" placeholder="Mon-Fri 7am-5pm" />
            </div>
          </div>
          <div>
            <label htmlFor="quote_policy" className="label">Quote / pricing policy</label>
            <textarea id="quote_policy" name="quote_policy" rows={2} defaultValue={settings?.quote_policy || ""} className="input mt-1" placeholder="Free quotes for installations. Service calls from $99..." />
          </div>
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <input id="emergency_available" name="emergency_available" type="checkbox" defaultChecked={settings?.emergency_available ?? false} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
              <label htmlFor="emergency_available" className="text-sm text-gray-700">Emergency service available</label>
            </div>
            <div className="flex items-center gap-2">
              <input id="after_hours_available" name="after_hours_available" type="checkbox" defaultChecked={settings?.after_hours_available ?? false} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
              <label htmlFor="after_hours_available" className="text-sm text-gray-700">After-hours available</label>
            </div>
          </div>
        </div>
      </div>

      {/* Enquiry Form / Booking */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Globe className="h-5 w-5 text-gray-400" />
          Enquiry Form & Booking
        </h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="enquiry_form_url" className="label">ServiceM8 enquiry form URL</label>
            <input id="enquiry_form_url" name="enquiry_form_url" type="url" defaultValue={settings?.enquiry_form_url || ""} className="input mt-1" placeholder="https://book.servicem8.com/..." />
            <p className="text-xs text-gray-500 mt-1">The bot will send this link to leads when they&apos;re ready to book.</p>
          </div>
          <div>
            <label htmlFor="signature" className="label">Email signature (for email follow-ups)</label>
            <textarea id="signature" name="signature" rows={2} defaultValue={settings?.signature || ""} className="input mt-1" placeholder={"Cheers,\nHarrison\nHR AIR"} />
          </div>
        </div>
      </div>

      {/* AI Settings */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Bot className="h-5 w-5 text-gray-400" />
          AI Behaviour
        </h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="ai_tone" className="label">AI tone</label>
              <select id="ai_tone" name="ai_tone" defaultValue={settings?.ai_tone || "friendly"} className="input mt-1">
                <option value="professional">Professional</option>
                <option value="friendly">Friendly</option>
                <option value="casual">Casual</option>
                <option value="conversational">Conversational</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label htmlFor="first_reply_behaviour" className="label">First message behaviour</label>
              <select id="first_reply_behaviour" name="first_reply_behaviour" defaultValue={settings?.first_reply_behaviour || "smart_reply"} className="input mt-1">
                <option value="smart_reply">Smart AI reply</option>
                <option value="simple_ack">Simple acknowledgment</option>
                <option value="disabled">Disabled (no auto-reply)</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="ai_style_instructions" className="label">Custom AI instructions (optional)</label>
            <textarea id="ai_style_instructions" name="ai_style_instructions" rows={2} defaultValue={settings?.ai_style_instructions || ""} className="input mt-1" placeholder="e.g. Always mention we offer free quotes. Use Australian slang." />
          </div>
        </div>
      </div>

      {/* Follow-up Settings */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-gray-400" />
          Follow-up Settings
        </h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="max_follow_ups" className="label">Max follow-ups per lead</label>
              <input id="max_follow_ups" name="max_follow_ups" type="number" min={1} max={20} defaultValue={settings?.max_follow_ups || 5} className="input mt-1" />
            </div>
            <div>
              <label htmlFor="follow_up_interval_days" className="label">Days between follow-ups</label>
              <input id="follow_up_interval_days" name="follow_up_interval_days" type="number" min={1} max={30} defaultValue={settings?.follow_up_interval_days || 3} className="input mt-1" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input id="stop_on_reply" name="stop_on_reply" type="checkbox" defaultChecked={settings?.stop_on_reply ?? true} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
            <label htmlFor="stop_on_reply" className="text-sm text-gray-700">Stop follow-ups when lead replies</label>
          </div>
          <div className="flex items-center gap-3">
            <input id="auto_follow_up_enabled" name="auto_follow_up_enabled" type="checkbox" defaultChecked={settings?.auto_follow_up_enabled ?? true} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
            <label htmlFor="auto_follow_up_enabled" className="text-sm text-gray-700">
              Auto-schedule follow-ups after every bot reply
              <span className="block text-xs text-gray-500">Off = follow-ups only run when you press the button on a lead.</span>
            </label>
          </div>
        </div>
      </div>

      {/* Comment Automation */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-gray-400" />
          Comment Automation
        </h2>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-2">
              <input id="comment_monitoring_enabled" name="comment_monitoring_enabled" type="checkbox" defaultChecked={settings?.comment_monitoring_enabled ?? true} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
              <label htmlFor="comment_monitoring_enabled" className="text-sm text-gray-700">Enable comment monitoring</label>
            </div>
            <div className="flex items-center gap-2">
              <input id="private_reply_enabled" name="private_reply_enabled" type="checkbox" defaultChecked={settings?.private_reply_enabled ?? true} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
              <label htmlFor="private_reply_enabled" className="text-sm text-gray-700">Send private replies (DM)</label>
            </div>
            <div className="flex items-center gap-2">
              <input id="public_reply_enabled" name="public_reply_enabled" type="checkbox" defaultChecked={settings?.public_reply_enabled ?? true} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
              <label htmlFor="public_reply_enabled" className="text-sm text-gray-700">Post public replies</label>
            </div>
          </div>
          <p className="text-xs text-gray-500">When someone comments on a post with interest signals, the bot classifies the comment, creates a lead, and replies via private message and/or public comment.</p>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="comment_confidence_threshold" className="label">Confidence threshold</label>
              <input id="comment_confidence_threshold" name="comment_confidence_threshold" type="number" step="0.05" min={0} max={1} defaultValue={settings?.comment_confidence_threshold ?? 0.4} className="input mt-1" />
              <p className="text-xs text-gray-500 mt-1">Min AI confidence to act (0-1)</p>
            </div>
            <div>
              <label htmlFor="comment_escalation_threshold" className="label">Escalation threshold</label>
              <input id="comment_escalation_threshold" name="comment_escalation_threshold" type="number" step="0.05" min={0} max={1} defaultValue={settings?.comment_escalation_threshold ?? 0.8} className="input mt-1" />
              <p className="text-xs text-gray-500 mt-1">Confidence for auto-escalation</p>
            </div>
            <div>
              <label htmlFor="comment_cooldown_minutes" className="label">Cooldown (minutes)</label>
              <input id="comment_cooldown_minutes" name="comment_cooldown_minutes" type="number" min={0} max={1440} defaultValue={settings?.comment_cooldown_minutes ?? 5} className="input mt-1" />
              <p className="text-xs text-gray-500 mt-1">Min time between replies to same user</p>
            </div>
          </div>

          <div>
            <label htmlFor="comment_lead_keywords" className="label">Custom lead keywords (comma-separated)</label>
            <input id="comment_lead_keywords" name="comment_lead_keywords" defaultValue={settings?.comment_lead_keywords?.join(", ") || ""} className="input mt-1" placeholder="price, quote, install, how much, interested, available" />
            <p className="text-xs text-gray-500 mt-1">Extra keywords that signal a potential lead (built-in keywords always active).</p>
          </div>

          <div>
            <label htmlFor="private_reply_templates" className="label">Private reply templates (one per line, use {"{name}"}, {"{business}"}, {"{link}"})</label>
            <textarea id="private_reply_templates" name="private_reply_templates" rows={3} defaultValue={settings?.private_reply_templates?.join("\n") || ""} className="input mt-1" placeholder={"Hey {name}! Thanks for reaching out to {business}. Get a quote here: {link}"} />
            <p className="text-xs text-gray-500 mt-1">Custom private message templates. Leave blank to use AI-generated defaults.</p>
          </div>

          {/* Legacy toggles hidden but still submitted */}
          <input type="hidden" name="comment_auto_reply" value={settings?.comment_monitoring_enabled ? "on" : ""} />
          <input type="hidden" name="dm_automation_enabled" value={settings?.private_reply_enabled ? "on" : ""} />
        </div>
      </div>

      {/* Escalation */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Shield className="h-5 w-5 text-gray-400" />
          Escalation Rules
        </h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="escalation_keywords" className="label">Escalation keywords (comma-separated)</label>
            <input id="escalation_keywords" name="escalation_keywords" defaultValue={settings?.escalation_keywords?.join(", ") || ""} className="input mt-1" placeholder="refund, lawyer, complaint, urgent, manager" />
            <p className="text-xs text-gray-500 mt-1">Messages containing these words will be flagged for human review.</p>
          </div>
        </div>
      </div>

      {/* Handoff Configuration */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <ArrowRightLeft className="h-5 w-5 text-gray-400" />
          Handoff Configuration
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          When the AI detects it can&apos;t handle a conversation (low confidence, escalation keywords, negative sentiment), it creates a &quot;handoff&quot; pausing automation until a human claims and resolves it.
        </p>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="handoff_auto_expire_hours" className="label">Auto-expire after (hours)</label>
              <input id="handoff_auto_expire_hours" name="handoff_auto_expire_hours" type="number" min={1} max={168} defaultValue={settings?.handoff_auto_expire_hours ?? 24} className="input mt-1" />
              <p className="text-xs text-gray-500 mt-1">If unclaimed, AI resumes after this many hours</p>
            </div>
            <div>
              <label htmlFor="handoff_low_confidence_threshold" className="label">Low confidence threshold</label>
              <input id="handoff_low_confidence_threshold" name="handoff_low_confidence_threshold" type="number" step="0.05" min={0} max={1} defaultValue={settings?.handoff_low_confidence_threshold ?? 0.3} className="input mt-1" />
              <p className="text-xs text-gray-500 mt-1">AI confidence below this triggers handoff</p>
            </div>
          </div>
        </div>
      </div>

      {/* Lead Scoring Weights */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-gray-400" />
          Lead Scoring Weights
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Adjust how much each signal contributes to the lead score. Higher weight = more influence on the final 0-100 score. Default is 1.0 for most categories.
        </p>
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label htmlFor="scoring_classification" className="label">Classification</label>
              <input id="scoring_classification" name="scoring_classification" type="number" step="0.1" min={0} max={3} defaultValue={settings?.scoring_classification ?? 1.0} className="input mt-1" />
            </div>
            <div>
              <label htmlFor="scoring_engagement" className="label">Engagement</label>
              <input id="scoring_engagement" name="scoring_engagement" type="number" step="0.1" min={0} max={3} defaultValue={settings?.scoring_engagement ?? 1.0} className="input mt-1" />
            </div>
            <div>
              <label htmlFor="scoring_urgency" className="label">Urgency</label>
              <input id="scoring_urgency" name="scoring_urgency" type="number" step="0.1" min={0} max={3} defaultValue={settings?.scoring_urgency ?? 1.0} className="input mt-1" />
            </div>
            <div>
              <label htmlFor="scoring_recency" className="label">Recency</label>
              <input id="scoring_recency" name="scoring_recency" type="number" step="0.1" min={0} max={3} defaultValue={settings?.scoring_recency ?? 1.0} className="input mt-1" />
            </div>
            <div>
              <label htmlFor="scoring_intent" className="label">Intent</label>
              <input id="scoring_intent" name="scoring_intent" type="number" step="0.1" min={0} max={3} defaultValue={settings?.scoring_intent ?? 1.0} className="input mt-1" />
            </div>
            <div>
              <label htmlFor="scoring_response_time" className="label">Response Time</label>
              <input id="scoring_response_time" name="scoring_response_time" type="number" step="0.1" min={0} max={3} defaultValue={settings?.scoring_response_time ?? 0.8} className="input mt-1" />
            </div>
            <div>
              <label htmlFor="scoring_source" className="label">Lead Source</label>
              <input id="scoring_source" name="scoring_source" type="number" step="0.1" min={0} max={3} defaultValue={settings?.scoring_source ?? 0.5} className="input mt-1" />
            </div>
            <div>
              <label htmlFor="estimated_lead_value" className="label">Lead Value ($)</label>
              <input id="estimated_lead_value" name="estimated_lead_value" type="number" min={0} max={100000} defaultValue={settings?.estimated_lead_value ?? 300} className="input mt-1" />
            </div>
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save settings
        </button>
        {saved && <span className="text-sm text-green-600 font-medium">Settings saved!</span>}
      </div>
    </form>
  );
}
