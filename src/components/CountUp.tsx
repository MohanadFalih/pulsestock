import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

export interface CountUpProps {
  value: number;
  /** Number of decimal places (default 0). */
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Animation duration in seconds (default 1.2). */
  duration?: number;
  /** Custom formatter; overrides prefix/suffix/decimals. */
  format?: (v: number) => string;
  className?: string;
}

/**
 * Animates a number 0 → value over 1.2s with easeOutExpo.
 * Respects prefers-reduced-motion (jumps straight to the value).
 */
export function CountUp({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 1.2,
  format,
  className,
}: CountUpProps) {
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(reduceMotion ? value : 0);
  const prevValue = useRef(0);

  useEffect(() => {
    if (reduceMotion) {
      setDisplay(value);
      return;
    }
    const controls = animate(prevValue.current, value, {
      duration,
      ease: easeOutExpo,
      onUpdate: (v) => setDisplay(v),
    });
    prevValue.current = value;
    return () => controls.stop();
  }, [value, duration, reduceMotion]);

  const text = format
    ? format(display)
    : `${prefix}${display.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}${suffix}`;

  return <span className={className}>{text}</span>;
}

export default CountUp;
