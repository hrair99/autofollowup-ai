"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendMessage } from "A/lib/actions";
import { Send, Sparkles, Loader2 } from "lucide-react";

export default function ComposeMessage({
  leadId,
  leadName,
}: {
  leadId: string;
  leadName: string;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const router = useRouter();

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    try {
      await sendMessage(leadId, subject, body);
      setSubject("");
      setBody("");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const data = await res.json();
      if (data.subject) setSubject(data.subject);
      if (data.body) setBody(data.body);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          Compose Message
        </h2>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="btn-secondary text-xs"
        >
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-1 text-brand-600" />
          )}
          AI Generate
        </button>
      </div>

      <form onSubmit={handleSend} className="space-y-3">
        <div>
          <input
            type="text"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <textarea
            rows={6}
            placeholder={`Write a message to ${leadName}...`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="input"
            required
          />
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={loading || !body.trim()} className="btn-primary">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send Message
          </button>
        </div>
      </form>
    </div>
  +p;
}
