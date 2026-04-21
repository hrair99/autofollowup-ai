export default function LeadsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-8 w-32 rounded bg-gray-200 animate-pulse" />
          <div className="mt-1 h-4 w-48 rounded bg-gray-100 animate-pulse" />
        </div>
        <div className="h-10 w-28 rounded-lg bg-gray-200 animate-pulse" />
      </div>

      {/* Filter bar skeleton */}
      <div className="flex gap-3">
        <div className="h-10 w-40 rounded-lg bg-gray-200 animate-pulse" />
        <div className="h-10 w-40 rounded-lg bg-gray-200 animate-pulse" />
      </div>

      {/* Table skeleton */}
      <div className="rounded-xl border border-gray-200 bg-white">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-gray-100 px-6 py-4"
          >
            <div className="h-4 w-32 rounded bg-gray-200 animate-pulse" />
            <div className="h-4 w-24 rounded bg-gray-100 animate-pulse" />
            <div className="h-5 w-20 rounded-full bg-gray-200 animate-pulse" />
            <div className="ml-auto h-4 w-16 rounded bg-gray-100 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
