"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { addFaqEntry, updateFaqEntry, deleteFaqEntry, toggleFaqActive } from "@/lib/actions";
import { Plus, Trash2, Loader2, HelpCircle, Edit2, Check, X, Toggle2 } from "lucide-react";
import type { FaqEntry } from "@/lib/types";

const CATEGORIES = ["general", "pricing", "services", "booking", "areas"];

const CATEGORY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  general: { bg: "bg-blue-100", text: "text-blue-700", label: "General" },
  pricing: { bg: "bg-green-100", text: "text-green-700", label: "Pricing" },
  services: { bg: "bg-purple-100", text: "text-purple-700", label: "Services" },
  booking: { bg: "bg-orange-100", text: "text-orange-700", label: "Booking" },
  areas: { bg: "bg-pink-100", text: "text-pink-700", label: "Service Areas" },
};

interface EditingEntry {
  id: string;
  question: string;
  answer: string;
  category: string;
  keywords: string;
}

export default function FaqManager({ entries }: { entries: FaqEntry[] }) {
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [editData, setEditData] = useState<EditingEntry | null>(null);
  const router = useRouter();

  // Count entries per category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: entries.length };
    CATEGORIES.forEach((cat) => {
      counts[cat] = entries.filter((e) => e.category === cat).length;
    });
    return counts;
  }, [entries]);

  // Filter entries by category
  const filteredEntries = useMemo(() => {
    if (selectedCategory === "all") return entries;
    return entries.filter((e) => e.category === selectedCategory);
  }, [entries, selectedCategory]);

  // Handle add form submission
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

  // Start editing an entry
  function startEdit(entry: FaqEntry) {
    setEditingId(entry.id);
    setEditData({
      id: entry.id,
      question: entry.question,
      answer: entry.answer,
      category: entry.category,
      keywords: entry.keywords.join(", "),
    });
  }

  // Save edited entry
  async function handleSaveEdit() {
    if (!editData) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("question", editData.question);
      formData.append("answer", editData.answer);
      formData.append("category", editData.category);
      formData.append("keywords", editData.keywords);
      await updateFaqEntry(editData.id, formData);
      setEditingId(null);
      setEditData(null);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  // Cancel editing
  function handleCancelEdit() {
    setEditingId(null);
    setEditData(null);
  }

  // Delete entry
  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deleteFaqEntry(id);
      router.refresh();
    } finally {
      setDeleting(null);
    }
  }

  // Toggle active status
  async function handleToggleActive(id: string, currentActive: boolean) {
    setToggling(id);
    try {
      await toggleFaqActive(id, !currentActive);
      router.refresh();
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="max-w-4xl">
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

      {/* Category Filter Tabs */}
      {entries.length > 0 && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          <button
            onClick={() => setSelectedCategory("all")}
            className={`whitespace-nowrap px-4 py-2 rounded-lg text-sm font-medium transition ${
              selectedCategory === "all"
                ? "bg-blue-100 text-blue-700"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            All <span className="ml-1 text-xs font-semibold">({categoryCounts.all})</span>
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`whitespace-nowrap px-4 py-2 rounded-lg text-sm font-medium transition ${
                selectedCategory === cat
                  ? `${CATEGORY_COLORS[cat].bg} ${CATEGORY_COLORS[cat].text}`
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {CATEGORY_COLORS[cat].label} <span className="ml-1 text-xs font-semibold">({categoryCounts[cat]})</span>
            </button>
          ))}
        </div>
      )}

      {filteredEntries.length === 0 ? (
        <div className="card text-center py-8 text-gray-500 text-sm">
          {selectedCategory === "all"
            ? "No FAQ entries yet. Add common questions and the AI will use them when replying."
            : `No FAQ entries in ${CATEGORY_COLORS[selectedCategory].label}.`}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEntries.map((entry) => (
            <div
              key={entry.id}
              className={`card transition ${!entry.is_active ? "opacity-60 bg-gray-50" : ""}`}
            >
              {editingId === entry.id ? (
                // Inline Edit Mode
                <div className="space-y-3">
                  <div>
                    <label className="label text-xs">Question</label>
                    <input
                      type="text"
                      value={editData?.question || ""}
                      onChange={(e) => setEditData({ ...editData!, question: e.target.value })}
                      className="input mt-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="label text-xs">Answer</label>
                    <textarea
                      value={editData?.answer || ""}
                      onChange={(e) => setEditData({ ...editData!, answer: e.target.value })}
                      rows={3}
                      className="input mt-1 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label text-xs">Category</label>
                      <select
                        value={editData?.category || "general"}
                        onChange={(e) => setEditData({ ...editData!, category: e.target.value })}
                        className="input mt-1 text-sm"
                      >
                        <option value="general">General</option>
                        <option value="pricing">Pricing</option>
                        <option value="services">Services</option>
                        <option value="booking">Booking</option>
                        <option value="areas">Service Areas</option>
                      </select>
                    </div>
                    <div>
                      <label className="label text-xs">Keywords (comma-separated)</label>
                      <input
                        type="text"
                        value={editData?.keywords || ""}
                        onChange={(e) => setEditData({ ...editData!, keywords: e.target.value })}
                        className="input mt-1 text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      disabled={loading}
                      className="btn-primary text-sm flex-1 flex items-center justify-center"
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="btn-secondary text-sm flex-1 flex items-center justify-center"
                    >
                      <X className="h-4 w-4 mr-1" />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                // Display Mode
                <>
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium text-sm ${!entry.is_active ? "text-gray-500 line-through" : "text-gray-900"}`}>
                        {entry.question}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(entry.id, entry.is_active)}
                        disabled={toggling === entry.id}
                        title={entry.is_active ? "Disable" : "Enable"}
                        className="p-1 text-gray-400 hover:text-blue-600 transition"
                      >
                        {toggling === entry.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Toggle2 className={`h-4 w-4 ${entry.is_active ? "text-blue-600" : ""}`} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(entry)}
                        disabled={editingId !== null}
                        className="p-1 text-gray-400 hover:text-gray-600 transition disabled:opacity-50"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(entry.id)}
                        disabled={deleting === entry.id}
                        className="p-1 text-gray-400 hover:text-red-600 transition"
                      >
                        {deleting === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <p className={`text-sm mt-2 whitespace-pre-wrap ${!entry.is_active ? "text-gray-500" : "text-gray-600"}`}>
                    {entry.answer}
                  </p>

                  <div className="flex items-center gap-2 flex-wrap mt-3">
                    <span
                      className={`inline-block text-xs font-medium px-2 py-1 rounded ${
                        CATEGORY_COLORS[entry.category].bg
                      } ${CATEGORY_COLORS[entry.category].text}`}
                    >
                      {CATEGORY_COLORS[entry.category].label}
                    </span>
                    {entry.keywords.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {entry.keywords.map((keyword) => (
                          <span
                            key={keyword}
                            className="inline-block text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded-full"
                          >
                            {keyword}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
