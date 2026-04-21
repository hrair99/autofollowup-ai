export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-48 rounded bg-gray-200 animate-pulse" />
        <div className="mt-1 h-4 w-64 rounded bg-gray-100 animate-pulse" />
      </div>

      {/* Stat cards skeleton */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="h-4 w-24 rounded bg-gray-200 animate-pulse" />
            <div className="mt-3 h-8 w-16 rounded bg-gray-200 animate-pulse" />
          </div>
        ))}
      </div>

      {/* Chart skeleton */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="h-4 w-32 rounded bg-gray-200 animate-pulse" />
        <div className="mt-4 h-48 rounded bg-gray-100 animate-pulse" />
      </div>
    </div>
  );
}
