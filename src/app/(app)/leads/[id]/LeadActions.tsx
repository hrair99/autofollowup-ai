"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateLeadStatus, deleteLead, scheduleFollowUps } from "@/lib/actions";
import type { Lead, LeadStatus } from "@/lib/types";
import {
  Play,
  Pause,
  CheckCircle,
  XCircle,
  Trash2,
  Loader2,
  CalendarPlus,
} from "lucide-react";

export default function LeadActions({ lead }: { lead: Lead }) {
  const [loading, setLoading] = useState<string | null>(null);
  const router = useRouter();

  async function handleStatus(status: LeadStatus) {
    setLoading(status);
    try {
      await updateLeadStatus(lead.id, status);
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this lead?")) return;
    setLoading("delete");
    try {
      await deleteLead(lead.id);
      router.push("/leads");
    } finally {
      setLoading(null);
    }
  }

  async function handleSchedule() {
    setLoading("schedule");
    try {
      await scheduleFollowUps(lead.id);
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  const isTerminal = ["responded", "booked", "dead"].includes(lead.status);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!isTerminal && (
        <button onClick={handleSchedule} className="btn-primary text-xs" disabled={loading !== null}>
          {loading === "schedule" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <CalendarPlus className="h-3.5 w-3.5 mr-1" />
          )}
          Schedule Follow-ups
        </button>
      )}

      {lead.status !== "responded" && (
        <button
          onClick={() => handleStatus("responded")}
          className="btn-secondary text-xs"
          disabled={loading !== null}
        >
          {loading === "responded" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <CheckCircle className="h-3.5 w-3.5 mr-1 text-green-600" />
          )}
          Responded
        </button>
      )}

      {lead.status !== "booked" && (
        <button
          onClick={() => handleStatus("booked")}
          className="btn-secondary text-xs"
          disabled={loading !== null}
        >
          {loading === "booked" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <CheckCircle className="h-3.5 w-3.5 mr-1 text-emerald-600" />
          )}
          Booked
        </button>
      )}

      {lead.status !== "dead" && (
        <button
          onClick={() => handleStatus("dead")}
          className="btn-secondary text-xs"
          disabled={loading !== null}
        >
          {loading === "dead" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <XCircle className="h-3.5 w-3.5 mr-1 text-gray-500" />
          )}
          Dead
        </button>
      )}

      <button
        onClick={handleDelete}
        className="btn-danger text-xs"
        disabled={loading !== null}
      >
        {loading === "delete" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
        ) : (
          <Trash2 className="h-3.5 w-3.5 mr-1" />
        )}
        Delete
      </button>
    </div>
  );
}
