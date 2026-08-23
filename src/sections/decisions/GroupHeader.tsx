import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { EASE } from "./ActionCard";

export interface GroupHeaderProps {
  color: string;
  title: string;
  count: number;
  caption: string;
  /** Pulse the dot (urgent groups). */
  pulse?: boolean;
  /** Brief lime ring flash when a summary chip scrolls here. */
  flash?: boolean;
}

/** Sticky group header: pulsing colored dot + title + count chip + caption. */
export function GroupHeader({ color, title, count, caption, pulse, flash }: GroupHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.35, ease: EASE }}
      className={cn(
        "sticky top-14 z-10 -mx-2 flex flex-wrap items-center gap-2.5 rounded-lg bg-abyss/85 px-2 py-2.5 backdrop-blur-sm transition-shadow duration-500",
        flash && "shadow-glow-lime"
      )}
    >
      <span className="relative flex h-2 w-2">
        {pulse && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
            style={{ backgroundColor: color, animationDuration: "2s" }}
          />
        )}
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      </span>
      <h2 className="font-display text-[18px] font-semibold text-text-primary">{title}</h2>
      <span
        className="rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tnum"
        style={{ color, backgroundColor: `${color}1A`, border: `1px solid ${color}40` }}
      >
        {count}
      </span>
      <span className="ml-auto hidden text-[12px] text-text-muted md:inline">{caption}</span>
    </motion.div>
  );
}

export default GroupHeader;
