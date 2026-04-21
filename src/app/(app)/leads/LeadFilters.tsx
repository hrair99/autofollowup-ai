"use client";

import { useRouter } from "next/navigation";

interface Props {
  statusFilter: string;
  scoreTierFilter: string;
}

export default function LeadFilters({ statusFilter, scoreTierFilter }: Props) {
  const router = useRouter();

  function getFilterUrl(newStatus?: string, newScore?: string): string {
    const params = new URLSearchParams();
    const status = newStatus !== undefined ? newStatus : statusFilter;
    const score = newScore !== undefined ? newScore : scoreTierFilter;
    if (status !== "all") params.set("status", status);
    if (score !== "all") params.set("score", score);
    return `/leads${params.toString() ? "?" + params.toString() : ""}`;
  }

  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <label className="block text-xs font-semibold text-gray-700 mb-2">
            Status
          </label>
          <select
            defaultValue={statusFilter}
            onChange={(e) => {
              router.push(getFilterUrl(e.target.value, undefined));
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          >
            <option value="all">All statuses</option>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="following_up">Following Up</option>
            <option value="responded">Responded</option>
            <option value="booked">Booked</option>
            <option value="dead">Dead</option>
          </select>
        </div>

        <div className="flex-1">
          <label className="block text-xs font-semibold text-gray-700 mb-2">
            Lead Score
          </label>
          <select
            defaultValue={scoreTierFilter}
            onChange={(e) => {
              router.push(getFilterUrl(undefined, e.target.value));
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          >
            <option value="all">All scores</option>
            <option value="hot">Hot (65+)</option>
            <option value="warm">Warm (35-64)</option>
            <option value="cold">&lt;35 (Cold)</option>
          </select>
        </div>
      </div>
    </div>
  );
}
