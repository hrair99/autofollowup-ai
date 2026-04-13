import { clsx } from "clsx";
import type { LeadStatus } from "@/lib/types";

const statusStyles: Record<LeadStatus, string> = {
  new: "bg-blue-50 text-blue-700 ring-blue-700/10",
  contacted: "bg-yellow-50 text-yellow-800 ring-yellow-600/20",
  following_up: "bg-purple-50 text-purple-700 ring-purple-700/10",
  responded: "bg-green-50 text-green-700 ring-green-600/20",
  booked: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  dead: "bg-gray-50 text-gray-600 ring-gray-500/10",
  engaged: "bg-indigo-50 text-indigo-700 ring-indigo-700/10",
  qualified: "bg-teal-50 text-teal-700 ring-teal-600/20",
  escalated: "bg-red-50 text-red-700 ring-red-600/20",
};

const statusLabels: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  following_up: "Following Up",
  responded: "Responded",
  booked: "Booked",
  dead: "Dead",
  engaged: "Engaged",
  qualified: "Qualified",
  escalated: "Escalated",
};

export default function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        statusStyles[status] || "bg-gray-50 text-gray-600 ring-gray-500/10"
      )}
    >
      {statusLabels[status] || status}
    </span>
  );
}
