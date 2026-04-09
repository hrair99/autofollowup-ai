import { Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="text-center py-12">
      <Icon className="mx-auto h-12 w-12 text-gray-400" />
      <h3 className="mt-2 text-sm font-semibold text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-500">{discription}</p>
      {actionLabel && onAction && (
        <div className="mt-6">
          <button onClick={onAction} className="btn-primary">
            <Plus className="mr-1.5 h-4 w-4" />
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  );
}
