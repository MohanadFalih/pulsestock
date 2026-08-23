import { useMemo } from "react";
import { Check, Minus, X } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  scaleReadiness,
  type ScaleCheck,
  type ScaleReadiness,
} from "@/data/decisionEngine";
import type { Product } from "@/data/products";
import { cn } from "@/lib/utils";

export const SCALE_LIGHT_META: Record<
  ScaleReadiness,
  { label: string; color: string }
> = {
  safe: { label: "Safe to scale", color: "#4ADE80" },
  caution: { label: "Scale with caution", color: "#FBBF24" },
  blocked: { label: "Do not scale", color: "#FB5D7A" },
  "not-applicable": { label: "—", color: "#5B6875" },
};

/** ✓ / ✗ / – marker for one readiness check. */
export function ScaleCheckIcon({ ok, className }: { ok: boolean | null; className?: string }) {
  if (ok === true) return <Check className={cn("h-3 w-3", className)} style={{ color: "#4ADE80" }} />;
  if (ok === false) return <X className={cn("h-3 w-3", className)} style={{ color: "#FB5D7A" }} />;
  return <Minus className={cn("h-3 w-3", className)} style={{ color: "#FBBF24" }} />;
}

/** Shared checks breakdown (used by the hover tooltip and the Vitals card). */
export function ScaleCheckList({ checks }: { checks: ScaleCheck[] }) {
  if (checks.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {checks.map((c) => (
        <li key={c.label} className="flex items-start gap-1.5">
          <ScaleCheckIcon ok={c.ok} className="mt-0.5 shrink-0" />
          <span className="min-w-0">
            <span className="font-semibold">{c.label}: </span>
            <span className="opacity-80">{c.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface ScaleLightProps {
  product: Product;
  /** Compact variant for dense list rows. */
  size?: "default" | "sm";
  className?: string;
}

/**
 * "Safe to scale" traffic light — colored dot + uppercase label chip with a
 * hover tooltip breaking down the four readiness checks (supplier cover,
 * return rate, ROAS, sales velocity).
 */
export function ScaleLight({ product, size = "default", className }: ScaleLightProps) {
  const verdict = useMemo(() => scaleReadiness(product), [product]);
  const meta = SCALE_LIGHT_META[verdict.readiness];
  const sm = size === "sm";

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex cursor-default items-center rounded-md border font-bold uppercase",
              sm
                ? "gap-1 px-1.5 py-px text-[9.5px] tracking-[0.6px]"
                : "gap-1.5 px-2 py-0.5 text-[10.5px] tracking-[0.8px]",
              className
            )}
            style={{
              color: meta.color,
              backgroundColor: `${meta.color}14`,
              borderColor: `${meta.color}40`,
            }}
          >
            <span
              className={cn("rounded-full", sm ? "h-1 w-1" : "h-1.5 w-1.5")}
              style={{ backgroundColor: meta.color }}
            />
            {meta.label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[280px] px-3 py-2">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.8px]" style={{ color: meta.color }}>
            {verdict.readiness === "not-applicable" ? "Not applicable" : meta.label}
          </p>
          {verdict.checks.length > 0 ? (
            <ScaleCheckList checks={verdict.checks} />
          ) : (
            <p className="opacity-80">{verdict.reasons[0]}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default ScaleLight;
