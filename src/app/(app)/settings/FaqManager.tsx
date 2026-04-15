"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addFaqEntry, deleteFaqEntry } from "@/lib/actions";
import { Plus, Trash2, Loader2, HelpCircle } from "lucide-react";
import type { FaqEntry } from "@/lib/types";

export default function FaqManager({ entries }: { entries: FaqEntry[] }) {
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const router = useRouter();

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      const formData = new FormData(e.currentTarget);
      await addFaqEntry(formData);
      setShowForm(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deleteFaqEntry(id);
      router.refresh();
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <HelpCircle className="h-5 w-5 text-gray-400" />
          FAQ / Knowledge Base
        </h2>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="btn-secondary text-sm"
        >
          <Plus className="h-4 w-4 mr-1" />
          Add FAQ
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Add common questions and answers. The AI will reference these when replying to customers.
      </p>

      {showForm && (
        <form onSubmit={handleAdd} className="card mb-4 space-y-3">
          <div>
            <label htmlFor="question" className="label">Question</label>
            <input id="question" name="question" required className="input mt-1" placeholder="e.g. How much does a split system install cost?" />
          </div>
          <div>
            <label htmlFor="answer" className="label">Answer</label>
            <textarea id="answer" name="answer" required rows={3} className="input mt-1" placeholder="e.g. Split system installation starts from $X. The exact price depends on..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="category" className="label">Category</label>
              <select id="category" name="category" className="input mt-1">
                <option value="general">General</option>
                <option value="pricing">Pricing</option>
                <option value="services">Services</option>
                <option value="booking">Booking</option>
                <option value="areas">Service Areas</option>
              </select>
            </div>
            <div>
              <label htmlFor="keywords" className="label">Keywords (comma-separated)</label>
              <input id="keywords" name="keywords" className="input mt-1" placeholder="price, cost, split system" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="btn-primary text-sm">
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Add
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      {entries.length === 0 ? (
        <div className="card text-center py-8 text-gray-500 text-sm">
          No FAQ entries yet. Add common questions and the AI will use them when replying.
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div key={entry.id} className="card flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 text-sm">{entry.question}</p>
                <p className="text-gray-600 text-sm mt-1 whitespace-pre-wrap">{entry.answer}</p>
                {entry.category !== "general" && (
                  <span className="inline-block mt-1 text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                    {entry.category}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(entry.id)}
                disabled={deleting === entry.id}
                className="text-gray-400 hover:text-red-600 p-1"
              >
                {deleting === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
