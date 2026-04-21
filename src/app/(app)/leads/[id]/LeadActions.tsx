"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateLeadStatus,
  deleteLead,
  scheduleFollowUps,
  toggleHumanReview,
} from "@/lib/actions";
import type { Lead, LeadStatus } from "@/lib/types";
import type { HandoffRecord } from "@/lib/conversation/handoff";
import {
  CheckCircle,
  XCircle,
  Trash2,
  Loader2,
  CalendarPlus,
  ShieldCheck,
  ShieldAlert,
  UserCheck,
  UserX,
  MessageSquareOff,
} from "lucide-react";

interface Props {
  lead: Lead;
  activeHandoff: HandoffRecord | null;
}

export default function LeadActions({ lead, activeHandoff }: Props) {
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

  async function handleHandoff(action: "claim" | "resolve") {
    if (!activeHandoff) return;
    setLoading(`handoff_${action}`);
    try {
      await fetch("/api/handoffs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handoffId: activeHandoff.id, action }),
      });
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  async function handleCreateHandoff() {
    setLoading("create_handoff");
    try {
      await fetch("/api/handoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          reason: "manual_escalation",
          priority: "normal",
        }),
      });
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  async function handleHumanReview() {
    setLoading("human_review");
    try {
      await toggleHumanReview(lead.id, !lead.requires_human_review, "manual_toggle");
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  const isTerminal = ["responded", "booked", "dead"].includes(lead.status);

  return (
    <div className="flex flex-col gap-2 sm:items-end">
      {/* Primary actions row */}
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
      </div>

      {/* Handoff + AI controls row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Handoff claim/resolve */}
        {activeHandoff && activeHandoff.status === "open" && (
          <button
            onClick={() => handleHandoff("claim")}
            className="btn-secondary text-xs border-blue-200 text-blue-700 hover:bg-blue-50"
            disabled={loading !== null}
          >
            {loading === "handoff_claim" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <UserCheck className="h-3.5 w-3.5 mr-1" />
            )}
            Claim Handoff
          </button>
        )}

        {activeHandoff && (activeHandoff.status === "open" || activeHandoff.status === "claimed") && (
          <button
            onClick={() => handleHandoff("resolve")}
            className="btn-secondary text-xs border-green-200 text-green-700 hover:bg-green-50"
            disabled={loading !== null}
          >
            {loading === "handoff_resolve" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5 mr-1" />
            )}
            Resolve & Resume AI
          </button>
        )}

        {/* Create handoff (pause AI) — only if no active handoff */}
        {!activeHandoff && !isTerminal && (
          <button
            onClick={handleCreateHandoff}
            className="btn-secondary text-xs border-yellow-200 text-yellow-700 hover:bg-yellow-50"
            disabled={loading !== null}
          >
            {loading === "create_handoff" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <MessageSquareOff className="h-3.5 w-3.5 mr-1" />
            )}
            Pause AI
          </button>
        )}

        {/* Human review toggle */}
        <button
          onClick={handleHumanReview}
          className={`btn-secondary text-xs ${
            lead.requires_human_review
              ? "border-purple-200 text-purple-700 hover:bg-purple-50"
              : ""
          }`}
          disabled={loading !== null}
        >
          {loading === "human_review" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : lead.requires_human_review ? (
            <UserX className="h-3.5 w-3.5 mr-1" />
          ) : (
            <ShieldAlert className="h-3.5 w-3.5 mr-1" />
          )}
          {lead.requires_human_review ? "Clear Review Flag" : "Flag for Review"}
        </button>

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
    </div>
  );
}
