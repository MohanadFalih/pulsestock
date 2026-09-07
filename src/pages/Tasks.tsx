import { useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Check,
  ClipboardCheck,
  CloudOff,
  FlaskConical,
  Megaphone,
  Minus,
  OctagonX,
  PartyPopper,
  PauseCircle,
  PhoneCall,
  Plus,
  Rocket,
  Snowflake,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { ANCHOR_DATE, products } from "@/data/products";
import { getAdsSnapshot } from "@/data/adsProvider";
import { useOpsData } from "@/data/opsData";
import { useAdsVersion } from "@/data/windowStore";
import { generateTasks, type Task, type TaskRule } from "@/data/taskEngine";
import {
  setQuotaConfig,
  setTaskDone,
  useTaskStore,
} from "@/data/taskStore";
import EmptyState from "@/components/EmptyState";
import KpiCard from "@/components/KpiCard";
import ProgressBar from "@/components/ProgressBar";
import { fmtMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const staggerParent = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const riseChild = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } },
};

// ─── Display groups (role sections, ordered stop-loss → confirmation) ────────

type GroupKey =
  | "stop-loss"
  | "stopped"
  | "tests"
  | "scale"
  | "publishing"
  | "direct"
  | "followup"
  | "confirm";

const GROUP_ORDER: GroupKey[] = [
  "stop-loss",
  "stopped",
  "tests",
  "scale",
  "publishing",
  "direct",
  "followup",
  "confirm",
];

const GROUP_CONFIG: Record<
  GroupKey,
  {
    title: string;
    caption: string;
    icon: LucideIcon;
    color: string;
    /** Rules routed into this group. */
    rules: TaskRule[];
    /** Data-missing empty state (null = data always available). */
    missingKey: "ads" | "direct" | "confirm" | null;
    missingMessage?: string;
  }
> = {
  "stop-loss": {
    title: "Stop-loss — kill bleeding ads",
    caption: "Spend with zero sales — pause these in Meta first",
    icon: OctagonX,
    color: "#FB5D7A",
    rules: ["kill"],
    missingKey: "ads",
    missingMessage:
      "Meta ads sync pending — stop-loss rules need spend & purchase data.",
  },
  stopped: {
    title: "Stopped — switched-off winners",
    caption: "Ads paused in Meta while still selling — restart or ignore if intentional",
    icon: PauseCircle,
    color: "#FBBF24",
    rules: ["stopped"],
    missingKey: "ads",
    missingMessage: "Meta ads sync pending — delivery-state checks need ad statuses.",
  },
  tests: {
    title: "Ad tests — organic winners",
    caption: "Products pulling orders with no live ad get a small test budget",
    icon: FlaskConical,
    color: "#C6F04D",
    rules: ["test"],
    missingKey: null,
  },
  scale: {
    title: "Scale — push the winners",
    caption: "Cost per purchase under target — raise budgets 20-30%",
    icon: Rocket,
    color: "#4ADE80",
    rules: ["scale"],
    missingKey: "ads",
    missingMessage: "Meta ads sync pending — scale signals need CPP data.",
  },
  publishing: {
    title: "Publishing — daily intake",
    caption: "New models go live every day, plus the daily quota",
    icon: Megaphone,
    color: "#8B7CFF",
    rules: ["publish", "publish-quota"],
    missingKey: null,
  },
  direct: {
    title: "Direct sales — clearance",
    caption: "Aging stock follows the discount ladder; list the daily quota",
    icon: Tag,
    color: "#3EE6D8",
    rules: ["discount", "direct-quota"],
    missingKey: "direct",
    missingMessage:
      "Stock detail sync pending — showing returned-stock aggregates instead of per-variant ages.",
  },
  followup: {
    title: "Follow-up — quality & supplier",
    caption: "Hot return rates and stale supplier checks",
    icon: PhoneCall,
    color: "#FBBF24",
    rules: ["review", "supplier-check"],
    missingKey: null,
  },
  confirm: {
    title: "Confirmation desk",
    caption: "Orders with no delivery activity for more than 24h",
    icon: ClipboardCheck,
    color: "#45B7F5",
    rules: ["confirm-order"],
    missingKey: "confirm",
    missingMessage:
      "Order detail sync pending — confirmation rules need the orders list.",
  },
};

const PRIORITY_META: Record<Task["priority"], { label: string; color: string }> = {
  critical: { label: "Critical", color: "#FB5D7A" },
  high: { label: "High", color: "#FB923C" },
  normal: { label: "Normal", color: "#45B7F5" },
  low: { label: "Low", color: "#8A95A1" },
};

const PRIORITY_RANK: Record<Task["priority"], number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Tasks() {
  const ops = useOpsData();
  const adsVersion = useAdsVersion();
  const { doneMap, config } = useTaskStore();

  // ANCHOR_DATE is the dashboard's "today" (mock: Dec 5 2025; live: sync time).
  const now = ANCHOR_DATE;

  const { tasks, missing } = useMemo(
    () =>
      generateTasks({
        products,
        ops,
        now,
        adsAvailable: getAdsSnapshot() != null,
        config: {
          publishTargetPerDay: config.publishTargetPerDay,
          directListTargetPerDay: config.directListTargetPerDay,
        },
      }),
    // adsVersion re-runs the engine when the async Meta overlay lands.
    [ops, adsVersion, config, now]
  );

  const doneCount = tasks.filter((t) => doneMap[t.id]).length;
  const openCount = tasks.length - doneCount;
  const moneyAtStake = tasks
    .filter((t) => t.rule === "kill" && !doneMap[t.id])
    .reduce((a, t) => a + (t.moneyAtStake ?? 0), 0);
  const pct = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {/* ── Header: date + overall progress ───────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <motion.p
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
            className="text-[11px] font-semibold uppercase tracking-[1.2px] text-lime/80"
          >
            Daily War Room
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.06, ease: EASE }}
            className="mt-1 font-display text-[28px] font-semibold tracking-[-0.5px] text-text-primary"
          >
            Daily Tasks
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.21 }}
            className="mt-1 text-[13.5px] text-text-secondary"
          >
            {dateLabel} · rule-generated from Odoo + Meta + stock data · resets every
            morning
          </motion.p>
        </div>
        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="flex items-center gap-3 rounded-xl border border-hairline bg-panel px-4 py-3"
        >
          <ProgressRing pct={pct} />
          <div>
            <p className="font-mono text-[18px] font-semibold leading-none tnum text-text-primary">
              {doneCount}
              <span className="text-text-muted">/{tasks.length}</span>
            </p>
            <p className="mt-1 text-[11px] font-medium text-text-secondary">
              tasks done today
            </p>
          </div>
        </motion.div>
      </div>

      {/* ── Winter season banner ──────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.15, ease: EASE }}
        className="mb-6 flex items-center gap-3 rounded-xl border border-lime/25 bg-lime-dim px-4 py-3"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-lime/15 text-lime">
          <Snowflake className="h-4 w-4" />
        </span>
        <p className="text-[12.5px] text-text-secondary">
          <span className="font-semibold text-text-primary">Winter season launch.</span>{" "}
          Prioritize the publishing quota — fresh models every day keep the winter
          pipeline full while ads find the winners.
        </p>
      </motion.div>

      {/* ── KPI mini-cards ────────────────────────────────────────────── */}
      <motion.div
        initial="hidden"
        animate="show"
        variants={staggerParent}
        className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        <motion.div variants={riseChild}>
          <KpiCard label="Tasks open" value={openCount} size="small" />
        </motion.div>
        <motion.div variants={riseChild}>
          <KpiCard
            label="Done today"
            value={doneCount}
            size="small"
            delta={
              pct === 100 && tasks.length > 0
                ? { text: "All clear", direction: "up", tone: "pos" }
                : { text: `${pct}% complete`, direction: "flat", tone: "neutral" }
            }
          />
        </motion.div>
        <motion.div variants={riseChild}>
          <KpiCard
            label="Money at stake"
            value={moneyAtStake}
            size="small"
            format={(v) => fmtMoney(v)}
            sparkColor="#FB5D7A"
            delta={
              moneyAtStake > 0
                ? { text: "stop-loss spend", direction: "down", tone: "neg" }
                : { text: "nothing bleeding", direction: "flat", tone: "pos" }
            }
          />
        </motion.div>
      </motion.div>

      {/* ── Role sections ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-10">
        {GROUP_ORDER.map((key) => (
          <TaskSection
            key={key}
            groupKey={key}
            tasks={tasks}
            doneMap={doneMap}
            missing={missing}
            quotaConfig={config}
          />
        ))}
      </div>
    </motion.div>
  );
}

// ─── Progress ring ───────────────────────────────────────────────────────────

function ProgressRing({ pct }: { pct: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <svg width={44} height={44} viewBox="0 0 44 44" className="-rotate-90">
      <circle cx={22} cy={22} r={r} fill="none" stroke="#232E3B" strokeWidth={5} />
      <circle
        cx={22}
        cy={22}
        r={r}
        fill="none"
        stroke="#C6F04D"
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - (pct / 100) * c}
        className="transition-[stroke-dashoffset] duration-700 ease-out"
      />
      <text
        x={22}
        y={22}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-text-primary font-mono text-[11px] font-semibold"
        transform="rotate(90 22 22)"
      >
        {pct}%
      </text>
    </svg>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

function TaskSection({
  groupKey,
  tasks,
  doneMap,
  missing,
  quotaConfig,
}: {
  groupKey: GroupKey;
  tasks: Task[];
  doneMap: Record<string, boolean>;
  missing: Record<string, boolean>;
  quotaConfig: { publishTargetPerDay: number; directListTargetPerDay: number };
}) {
  const cfg = GROUP_CONFIG[groupKey];
  const Icon = cfg.icon;
  const groupTasks = tasks
    .filter((t) => cfg.rules.includes(t.rule))
    .sort((a, b) => {
      const da = doneMap[a.id] ? 1 : 0;
      const db = doneMap[b.id] ? 1 : 0;
      if (da !== db) return da - db; // open first, done sink to the bottom
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    });
  const open = groupTasks.filter((t) => !doneMap[t.id]).length;
  const dataMissing = cfg.missingKey != null && missing[cfg.missingKey];
  const quotaValue =
    groupKey === "publishing"
      ? quotaConfig.publishTargetPerDay
      : groupKey === "direct"
        ? quotaConfig.directListTargetPerDay
        : null;

  return (
    <section aria-label={cfg.title} className="scroll-mt-28">
      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={staggerParent}
      >
        {/* Section header */}
        <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ color: cfg.color, backgroundColor: `${cfg.color}1A` }}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-[16px] font-semibold text-text-primary">
                {cfg.title}
              </h2>
              <span
                className="rounded-full px-1.5 py-px font-mono text-[10px] tnum"
                style={{ color: cfg.color, backgroundColor: `${cfg.color}1A` }}
              >
                {open} open
              </span>
            </div>
            <p className="text-[12px] text-text-muted">{cfg.caption}</p>
          </div>
          {quotaValue != null && (
            <QuotaStepper
              value={quotaValue}
              onChange={(v) =>
                setQuotaConfig(
                  groupKey === "publishing"
                    ? { publishTargetPerDay: v }
                    : { directListTargetPerDay: v }
                )
              }
            />
          )}
        </motion.div>

        {/* Body */}
        <div className="mt-3">
          {groupTasks.length === 0 && !dataMissing && (
            <motion.div variants={riseChild}>
              <EmptyState
                icon={PartyPopper}
                title="All clear"
                message="Nothing here today — new tasks arrive on the next sync."
                className="py-8"
              />
            </motion.div>
          )}
          {groupTasks.length === 0 && dataMissing && (
            <motion.div variants={riseChild}>
              <EmptyState
                icon={CloudOff}
                title="Sync pending"
                message={cfg.missingMessage ?? "Waiting for data."}
                className="py-8"
              />
            </motion.div>
          )}
          {groupTasks.length > 0 && (
            <div className="flex flex-col gap-2">
              {dataMissing && (
                <motion.p
                  variants={riseChild}
                  className="flex items-center gap-1.5 rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 text-[11.5px] text-amber"
                >
                  <CloudOff className="h-3.5 w-3.5 shrink-0" />
                  {cfg.missingMessage}
                </motion.p>
              )}
              {groupTasks.map((task) => (
                <motion.div key={task.id} variants={riseChild}>
                  <TaskRow task={task} done={doneMap[task.id] === true} />
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </section>
  );
}

// ─── Quota stepper ───────────────────────────────────────────────────────────

function QuotaStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const btn =
    "flex h-6 w-6 items-center justify-center rounded-md border border-hairline text-text-muted transition-colors hover:border-bright hover:text-text-primary";
  return (
    <div className="ml-auto flex items-center gap-1.5" title="Daily target">
      <span className="mr-1 text-[11px] font-medium uppercase tracking-[0.8px] text-text-muted">
        target
      </span>
      <button className={btn} onClick={() => onChange(Math.max(1, value - 1))} aria-label="Lower target">
        <Minus className="h-3 w-3" />
      </button>
      <span className="w-6 text-center font-mono text-[13px] font-semibold tnum text-text-primary">
        {value}
      </span>
      <button className={btn} onClick={() => onChange(Math.min(30, value + 1))} aria-label="Raise target">
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─── Task row ────────────────────────────────────────────────────────────────

function TaskRow({ task, done }: { task: Task; done: boolean }) {
  const prio = PRIORITY_META[task.priority];
  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-xl border border-hairline bg-panel px-4 py-3 transition-colors hover:border-bright",
        done && "opacity-55"
      )}
    >
      {/* Checkbox (persisted per day in taskStore) */}
      <button
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        onClick={() => setTaskDone(task.id, !done)}
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
          done
            ? "border-lime bg-lime text-abyss"
            : "border-bright bg-inset hover:border-lime/60"
        )}
      >
        {done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {/* Priority chip — StageBadge visual language */}
          <span
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.8px]"
            style={{ color: prio.color, backgroundColor: `${prio.color}14` }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: prio.color }}
            />
            {prio.label}
          </span>
          <p
            className={cn(
              "text-[13.5px] font-semibold text-text-primary",
              done && "line-through decoration-text-muted"
            )}
          >
            {task.title}
          </p>
          {task.moneyAtStake != null && (
            <span className="font-mono text-[12px] font-semibold tnum text-neg">
              {fmtMoney(task.moneyAtStake)}
            </span>
          )}
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
          {task.detail}
        </p>
        {task.progress && (
          <div className="mt-2 flex items-center gap-2">
            <ProgressBar
              value={(task.progress.done / task.progress.target) * 100}
              className="max-w-[220px]"
            />
            <span className="font-mono text-[11px] tnum text-text-muted">
              {Math.min(task.progress.done, task.progress.target)}/{task.progress.target}
            </span>
          </div>
        )}
      </div>

      {task.link && (
        <Link
          to={task.link}
          className="mt-0.5 flex shrink-0 items-center gap-1 rounded-lg border border-hairline px-2.5 py-1.5 text-[12px] font-semibold text-text-secondary transition-colors hover:border-bright hover:text-text-primary"
        >
          Open
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
