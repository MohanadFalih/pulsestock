import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlarmClock,
  Archive,
  Eye,
  Info,
  PartyPopper,
  PauseCircle,
  TrendingDown,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { globalKpis } from "@/data/products";
import { ALERT_META } from "@/data/decisionEngine";
import CountUp from "@/components/CountUp";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import ActionCard, { EASE, type CardTone } from "@/sections/decisions/ActionCard";
import GroupHeader from "@/sections/decisions/GroupHeader";
import ResolvedAccordion from "@/sections/decisions/ResolvedAccordion";
import { RevivalTracker } from "@/sections/decisions/DeadStockExtras";
import {
  alertCardContent,
  fmtCompactUsd,
  fmtUsd,
  GROUP_ANCHOR,
  groupEntries,
  groupForAlertParam,
  QUEUE_GROUPS,
  safeActionCount,
  supplierRiskDailySpend,
  type GroupEntry,
  type QueueGroupKey,
} from "@/sections/decisions/queueData";

// ─── Group display config ────────────────────────────────────────────────────

const GROUP_CONFIG: Record<
  QueueGroupKey,
  {
    color: string;
    tone: CardTone;
    title: string;
    caption: string;
    icon: LucideIcon;
    stamp: string;
    pulse?: boolean;
    dashed?: boolean;
    chipLabel: string;
    chipSub: string;
  }
> = {
  CRITICAL: {
    color: "#FB5D7A",
    tone: "rose",
    title: "Critical — Stop Ads Now",
    caption: "butiksistem stock is 0 while ads should be running",
    icon: PauseCircle,
    stamp: "Handled · just now",
    pulse: true,
    chipLabel: "Critical — supplier out",
    chipSub: "stop ads immediately",
  },
  ISSUES: {
    color: "#FB923C",
    tone: "orange",
    title: "Issues — High Returns",
    caption: "Return rate above 35% — likely a product or ad-promise issue",
    icon: TrendingDown,
    stamp: "Handled · just now",
    pulse: true,
    chipLabel: "Issues — returns >35%",
    chipSub: "investigate product & ads",
  },
  WATCH: {
    color: "#FBBF24",
    tone: "amber",
    title: "Watchlist",
    caption: "Returns in the 25–35% band, or supplier stock under ~7 days of cover",
    icon: Eye,
    stamp: "Handled · just now",
    chipLabel: "Watch — returns & supplier cover",
    chipSub: `~${fmtUsd(supplierRiskDailySpend())}/day spend at risk`,
  },
  SELL_OFF: {
    color: "#8A95A1",
    tone: "gray",
    title: "Returned Stock Sell-off",
    caption: "Returned units are the only stock left — push organic sell-through to zero",
    icon: Archive,
    stamp: "Revival started",
    dashed: true,
    chipLabel: `Returned stock — ${globalKpis.returnedStockUnits} units, ${fmtCompactUsd(globalKpis.returnedStockValue)} on the shelf`,
    chipSub: "14-day sell-off playbooks ready",
  },
  INFO: {
    color: "#45B7F5",
    tone: "blue",
    title: "Info — Measurement",
    caption: "Ads-live products: is the return rate measurable yet?",
    icon: Info,
    stamp: "Acknowledged",
    chipLabel: "Info — collecting data",
    chipSub: "return rate needs n≥10 delivered",
  },
};

/** Legacy `?decision=` values from the v1 verdict model. */
const LEGACY_DECISION_MAP: Record<string, QueueGroupKey> = {
  STOP_ADS: "CRITICAL",
  KILL: "ISSUES",
  DEAD_STOCK: "SELL_OFF",
  SCALE: "WATCH",
  ONBOARDING: "INFO",
  KEEP: "INFO",
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Decisions() {
  const location = useLocation();
  const [handledIds, setHandledIds] = useState<string[]>([]);
  const [flash, setFlash] = useState<QueueGroupKey | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  const groups = useMemo(
    () =>
      QUEUE_GROUPS.map((key) => ({ key, entries: groupEntries(key) })).filter(
        (g) => g.entries.length > 0
      ),
    []
  );

  const isHandled = useCallback(
    (productId: string) => handledIds.includes(productId),
    [handledIds]
  );
  const groupCleared = useCallback(
    (key: QueueGroupKey) => {
      const entries = groupEntries(key);
      return entries.length > 0 && entries.every((e) => isHandled(e.product.id));
    },
    [isHandled]
  );

  const onHandled = useCallback((productId: string) => {
    setHandledIds((ids) => (ids.includes(productId) ? ids : [...ids, productId]));
  }, []);

  const scrollToGroup = useCallback((key: QueueGroupKey) => {
    const el = document.getElementById(GROUP_ANCHOR[key]);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    window.clearTimeout(flashTimer.current);
    setFlash(key);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1000);
  }, []);

  // Deep links: `#dead-stock` style anchors (from Overview), `?alert=` (alert
  // id or type), or legacy `?decision=` filters — all map onto alert groups.
  useEffect(() => {
    const hash = location.hash.replace("#", "");
    const params = new URLSearchParams(location.search);
    const alertRaw = params.get("alert") ?? "";
    const decisionRaw = params.get("decision") ?? "";
    const fromAlert = alertRaw ? groupForAlertParam(alertRaw) : null;
    const decision = LEGACY_DECISION_MAP[decisionRaw] ?? decisionRaw;
    const target =
      fromAlert ??
      (Object.keys(GROUP_ANCHOR) as QueueGroupKey[]).find(
        (k) => GROUP_ANCHOR[k] === hash || k === decision
      );
    if (!target) return;
    const t = window.setTimeout(() => scrollToGroup(target), 400);
    return () => window.clearTimeout(t);
  }, [location.hash, location.search, scrollToGroup]);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {/* ── Section 1: header + queue summary ─────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <motion.p
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
            className="text-[11px] font-semibold uppercase tracking-[1.2px] text-lime/80"
          >
            Tracking Engine
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.06, ease: EASE }}
            className="mt-1 font-display text-[28px] font-semibold tracking-[-0.5px] text-text-primary"
          >
            Alerts &amp; Actions
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.21 }}
            className="mt-1 text-[13.5px] text-text-secondary"
          >
            {globalKpis.needsAttention} products need attention · {globalKpis.activeAlerts} active
            alerts · derived from Odoo + Meta + butiksistem on every sync
          </motion.p>
        </div>
        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="flex items-center gap-2"
        >
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => toast.info("All alerts snoozed for 24h (simulated)")}
            className="flex h-9 items-center gap-2 rounded-lg border border-hairline bg-panel px-3.5 text-[13px] font-semibold text-text-secondary transition-colors hover:border-bright hover:text-text-primary"
          >
            <AlarmClock className="h-4 w-4" />
            Snooze all 24h
          </motion.button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <motion.button
                whileTap={{ scale: 0.97 }}
                className="flex h-9 items-center gap-2 rounded-lg bg-lime px-3.5 text-[13px] font-semibold text-abyss transition-colors hover:brightness-110"
              >
                <Zap className="h-4 w-4" />
                Auto-apply safe actions
              </motion.button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Apply {safeActionCount()} safe actions?</AlertDialogTitle>
                <AlertDialogDescription>
                  Safe actions never delete stock or products: pause Meta campaigns on products the
                  supplier is out of, and reduce daily budgets where supplier cover is under ~7
                  days. Everything else stays in your queue.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    toast.success(`${safeActionCount()} safe actions applied (simulated)`)
                  }
                >
                  Apply actions
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </motion.div>
      </div>

      {/* Queue summary strip */}
      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
        className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5"
      >
        {groups.map(({ key, entries }) => {
          const cfg = GROUP_CONFIG[key];
          const cleared = groupCleared(key);
          const Icon = cfg.icon;
          return (
            <motion.button
              key={key}
              variants={{
                hidden: { opacity: 0, y: 14 },
                show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } },
              }}
              whileTap={{ scale: 0.97 }}
              onClick={() => scrollToGroup(key)}
              className="flex items-center gap-3 rounded-xl border border-hairline bg-panel px-4 py-3 text-left transition-colors hover:border-bright hover:bg-panel-hover"
            >
              <motion.span
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 380, damping: 20, delay: 0.15 }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ color: cfg.color, backgroundColor: `${cfg.color}1A` }}
              >
                <Icon className="h-4 w-4" />
              </motion.span>
              <span className="min-w-0">
                <span className="flex items-baseline gap-1.5">
                  <CountUp
                    value={entries.length}
                    className="font-mono text-[20px] font-semibold tnum text-text-primary"
                  />
                  <span className="truncate text-[12px] font-medium text-text-secondary">
                    {cfg.chipLabel}
                  </span>
                </span>
                <span
                  className={cn(
                    "block truncate text-[11px]",
                    cleared ? "font-semibold text-pos" : "text-text-muted"
                  )}
                >
                  {cleared ? "All handled" : cfg.chipSub}
                </span>
              </span>
            </motion.button>
          );
        })}
      </motion.div>

      {/* ── Sections 2–6: alert groups by urgency ─────────────────────── */}
      <div className="flex flex-col gap-10">
        {groups.map(({ key, entries }) => {
          const cfg = GROUP_CONFIG[key];
          const cleared = groupCleared(key);
          return (
            <section
              key={key}
              id={GROUP_ANCHOR[key]}
              className="scroll-mt-28"
              aria-label={cfg.title}
            >
              <GroupHeader
                color={cfg.color}
                title={cfg.title}
                count={entries.length}
                caption={cfg.caption}
                pulse={cfg.pulse}
                flash={flash === key}
              />
              <AnimatePresence mode="wait" initial={false}>
                {cleared ? (
                  <QueueClearedBanner key="cleared" />
                ) : (
                  <motion.div
                    key="cards"
                    initial="hidden"
                    whileInView="show"
                    viewport={{ once: true, margin: "-60px" }}
                    variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12 } } }}
                    exit={{ opacity: 0 }}
                    className="mt-3 flex flex-col gap-4"
                  >
                    {entries.map((entry) => (
                      <AlertCard key={`${key}:${entry.product.id}`} groupKey={key} entry={entry} onHandled={onHandled} />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          );
        })}
      </div>

      {/* ── Section 7: recently resolved ──────────────────────────────── */}
      <ResolvedAccordion />
    </motion.div>
  );
}

/** One card per product per group — merges the product's alerts in the group. */
function AlertCard({
  groupKey,
  entry,
  onHandled,
}: {
  groupKey: QueueGroupKey;
  entry: GroupEntry;
  onHandled: (productId: string) => void;
}) {
  const cfg = GROUP_CONFIG[groupKey];
  const content = alertCardContent(entry);
  const primaryMeta = ALERT_META[entry.alerts[0].type];
  return (
    <ActionCard
      product={entry.product}
      tone={cfg.tone}
      reasons={content.reasons}
      stats={content.stats}
      checklist={content.checklist}
      stampLabel={cfg.stamp}
      dashed={cfg.dashed}
      cashRecovery={content.cashRecovery}
      badge={
        <span
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.8px]"
          style={{ color: primaryMeta.color, backgroundColor: primaryMeta.bg }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: primaryMeta.color }} />
          {primaryMeta.label}
        </span>
      }
      extras={
        groupKey === "SELL_OFF"
          ? (done) => <RevivalTracker daysFilled={done} />
          : undefined
      }
      onHandled={onHandled}
    />
  );
}

/** Celebration banner shown when every card in a group is handled. */
function QueueClearedBanner() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="mt-3 flex flex-col items-center justify-center rounded-xl border border-dashed border-pos/40 bg-pos/5 px-8 py-10 text-center"
    >
      <motion.span
        initial={{ scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 16 }}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-lime/15 text-lime"
      >
        <PartyPopper className="h-5 w-5" />
      </motion.span>
      <p className="mt-3 font-display text-[15px] font-semibold text-text-primary">Queue clear.</p>
      <p className="mt-1 text-[12.5px] text-text-secondary">
        New alerts arrive on the next Odoo + butiksistem sync.
      </p>
    </motion.div>
  );
}
