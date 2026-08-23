import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title?: string;
  message: string;
  /** Ghost CTA label; when provided with onCta a button renders. */
  ctaLabel?: string;
  onCta?: () => void;
  /** Optional lucide icon; defaults to the empty-box.svg asset. */
  icon?: ComponentType<{ className?: string }>;
  className?: string;
}

/** Dashed-border panel with centered icon, message, and optional ghost CTA. */
export function EmptyState({ title, message, ctaLabel, onCta, icon: Icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-bright px-8 py-12 text-center",
        className
      )}
    >
      {Icon ? (
        <Icon className="h-8 w-8 text-text-muted" />
      ) : (
        <img src="/empty-box.svg" alt="" className="h-8 w-8 opacity-70" />
      )}
      {title && (
        <p className="mt-4 font-display text-[15px] font-semibold text-text-primary">{title}</p>
      )}
      <p className="mt-1 max-w-xs text-[12.5px] text-text-secondary">{message}</p>
      {ctaLabel && onCta && (
        <button
          onClick={onCta}
          className="mt-4 rounded-lg border border-hairline px-3 py-1.5 text-[13px] font-semibold text-text-secondary transition-colors hover:border-bright hover:text-text-primary"
        >
          {ctaLabel}
        </button>
      )}
    </div>
  );
}

export default EmptyState;
