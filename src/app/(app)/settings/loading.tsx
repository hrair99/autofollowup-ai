export default function SettingsLoading() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <div className="h-8 w-36 rounded bg-gray-200 animate-pulse" />
        <div className="mt-1 h-4 w-72 rounded bg-gray-100 animate-pulse" />
      </div>

      {/* Health cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 rounded-lg border border-gray-200 bg-gray-50 animate-pulse" />
        ))}
      </div>

      {/* Form sections skeleton */}
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="h-5 w-40 rounded bg-gray-200 animate-pulse" />
          <div className="mt-4 space-y-3">
            <div className="h-10 rounded bg-gray-100 animate-pulse" />
            <div className="h-10 rounded bg-gray-100 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
