import { cn } from "@/lib/utils";

export interface ProgressBarProps {
  /** 0–100. */
  value: number;
  /** Fill color (hex). When omitted, a lime gradient is used. */
  color?: string;
  /** Override the fill with a CSS gradient. */
  gradient?: string;
  className?: string;
  trackClassName?: string;
}

/** 6px track on bg-inset, animated fill (stock depletion, budget burn). */
export function ProgressBar({ value, color, gradient, className, trackClassName }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-inset", trackClassName, className)}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{
          width: `${clamped}%`,
          background:
            gradient ?? color ?? "linear-gradient(90deg, #C6F04D 0%, #A3D65C 100%)",
        }}
      />
    </div>
  );
}

export default ProgressBar;
