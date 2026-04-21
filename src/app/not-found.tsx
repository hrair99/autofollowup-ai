import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="max-w-md text-center px-4">
        <p className="text-6xl font-bold text-gray-300">404</p>
        <h2 className="mt-4 text-xl font-semibold text-gray-900">
          Page not found
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
