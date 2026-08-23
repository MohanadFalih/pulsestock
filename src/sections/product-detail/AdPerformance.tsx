import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PauseCircle, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { CountUp } from "@/components/CountUp";
import { RoasChip } from "@/components/RoasChip";
import { AdsHealthBadge } from "@/components/AdsHealthBadge";
import {
  ADS_PRESETS,
  adsPresetLabel,
  adsSyncLabel,
  fmtUsd,
  getAdsSnapshot,
  getAdsSnapshotSource,
  type AdsProduct,
} from "@/data/adsProvider";
import { useAdsVersion } from "@/data/windowStore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Product } from "@/data/products";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/money";
import { adEstimates, getCampaigns, isPostAds, money, money2, type Campaign } from "./derived";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Inline 7-day spend sparkline (52×18). */
function MiniSpark({ data, color }: { data: number[]; color: string }) {
  const w = 52;
  const h = 18;
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const px = (i: number) => (i / (data.length - 1)) * (w - 2) + 1;
  const py = (v: number) => h - 2 - (v / max) * (h - 4);
  const line = data.map((v, i) => `${px(i)},${py(v)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 opacity-80">
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusChip({ paused }: { paused: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.8px] transition-colors duration-300",
        paused ? "bg-amber/15 text-amber" : "bg-pos/15 text-pos"
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {!paused && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pos opacity-60" />
        )}
        <span
          className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", paused ? "bg-amber" : "bg-pos")}
        />
      </span>
      {paused ? "Paused" : "Active"}
    </span>
  );
}

function CampaignCard({
  campaign,
  paused,
  index,
}: {
  campaign: Campaign;
  paused: boolean;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.15 + index * 0.08, ease: EASE }}
      onClick={() => setExpanded((e) => !e)}
      className="w-full rounded-lg border border-hairline bg-inset p-3 text-left transition-colors hover:border-bright"
      aria-expanded={expanded}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold text-text-primary">{campaign.name}</p>
          <p className="text-[11px] text-text-muted">{campaign.platform}</p>
        </div>
        <StatusChip paused={paused} />
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[12px] text-text-secondary tnum">
            {money(campaign.spend)}
          </span>
          <RoasChip value={campaign.roas} className="text-[11.5px]" />
        </div>
        <MiniSpark data={campaign.spark} color={paused ? "#5B6875" : "#3EE6D8"} />
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="mt-2.5 flex items-center gap-4 border-t border-hairline pt-2.5 font-mono text-[11px] text-text-secondary tnum">
              <span>
                CTR <span className="text-text-primary">{campaign.ctr}%</span>
              </span>
              <span>
                CPM <span className="text-text-primary">{money2(campaign.cpm)}</span>
              </span>
              <span>
                CPC <span className="text-text-primary">{money2(campaign.cpc)}</span>
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

/** Live Meta body — rendered when the ads sync matched this SKU. */
function LiveAdsBody({ meta }: { meta: AdsProduct }) {
  const snapshot = getAdsSnapshot();
  const source = getAdsSnapshotSource();
  const rate = snapshot?.usdToIqd ?? 0;
  const targetCPA = snapshot?.config.targetCPA;
  const targetROAS = snapshot?.config.targetROAS;
  const rangeLabel =
    ADS_PRESETS.find((p) => p.key === snapshot?.dateRange)?.label ??
    adsPresetLabel(snapshot?.dateRange);
  const iqd = (usd: number) => fmtMoney(Math.round(usd * rate));

  // Impressions-weighted average frequency across the SKU's ads.
  let freq: number | null = null;
  {
    let imp = 0;
    let acc = 0;
    for (const ad of meta.ads) {
      if (ad.frequency == null || ad.impressions <= 0) continue;
      imp += ad.impressions;
      acc += ad.frequency * ad.impressions;
    }
    freq = imp > 0 ? acc / imp : null;
  }
  const cpm = meta.impressions > 0 ? (meta.spent / meta.impressions) * 1000 : null;

  const roasColor =
    meta.healthRoas != null && targetROAS != null
      ? meta.healthRoas >= targetROAS
        ? "#4ADE80"
        : "#FB5D7A"
      : "#E9EFF5";
  const cpaColor =
    meta.healthCpa != null && targetCPA != null
      ? meta.healthCpa <= targetCPA
        ? "#4ADE80"
        : "#FB5D7A"
      : "#E9EFF5";

  const stats = [
    { label: "Spend", value: fmtMoney(meta.spentIQD), sub: fmtUsd(meta.spent), color: "#E9EFF5" },
    {
      label: "ROAS",
      value: meta.healthRoas != null ? meta.healthRoas.toFixed(2) : "—",
      sub: targetROAS != null ? `target ${targetROAS.toFixed(1)}` : undefined,
      color: roasColor,
    },
    {
      label: "CPA",
      value: meta.healthCpa != null ? iqd(meta.healthCpa) : "—",
      sub:
        meta.healthCpa != null
          ? `${fmtUsd(meta.healthCpa)}${targetCPA != null ? ` · target ${fmtUsd(targetCPA)}` : ""}`
          : undefined,
      color: cpaColor,
    },
  ];

  return (
    <>
      <div className="mt-3 flex items-center gap-2">
        <AdsHealthBadge health={meta.health} />
        {snapshot?.healthWindow && (
          <span className="text-[10.5px] text-text-muted">{snapshot.healthWindow}</span>
        )}
      </div>

      {/* Live mini stats (IQD primary, USD subtext) */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg bg-inset px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[1px] text-text-muted">
              {s.label}
            </p>
            <p
              className="mt-0.5 truncate font-mono text-[15px] font-semibold tnum"
              style={{ color: s.color }}
            >
              {s.value}
            </p>
            {s.sub && <p className="mt-0.5 truncate text-[10px] text-text-muted">{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* Delivery metrics */}
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-text-secondary tnum">
        <span>
          Freq <span className="text-text-primary">{freq != null ? freq.toFixed(2) : "—"}</span>
        </span>
        <span>
          CPM <span className="text-text-primary">{cpm != null ? fmtUsd(cpm) : "—"}</span>
        </span>
        <span>
          Impr <span className="text-text-primary">{meta.impressions.toLocaleString()}</span>
        </span>
        <span>
          Purch <span className="text-text-primary">{meta.purchases}</span>
        </span>
      </div>

      {/* Per-ad breakdown */}
      <div className="mt-3 flex flex-col gap-2">
        {meta.ads.map((ad, i) => (
          <motion.div
            key={ad.id || ad.name}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.15 + i * 0.08, ease: EASE }}
            className="rounded-lg border border-hairline bg-inset p-3"
          >
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text-primary">
                {ad.name}
              </p>
              <StatusChip paused={ad.effectiveStatus !== "ACTIVE"} />
            </div>
            {ad.campaign && (
              <p className="mt-0.5 truncate text-[11px] text-text-muted">{ad.campaign}</p>
            )}
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="font-mono text-[12px] text-text-secondary tnum">
                {iqd(ad.spent)} <span className="text-text-muted">· {fmtUsd(ad.spent)}</span>
              </span>
              <AdsHealthBadge health={ad.health} dotless />
            </div>
          </motion.div>
        ))}
      </div>

      <p className="mt-3 text-[10.5px] text-text-muted">
        {source === "snapshot" ? "Snapshot (cached) from Meta" : "Live from Meta"} · {rangeLabel} ·{" "}
        {adsSyncLabel(snapshot?.syncedAt ?? null)} · manage campaigns in Ads Manager
      </p>
    </>
  );
}

/** Section 6 — right-rail Meta ad performance panel with pause interaction. */
export function AdPerformance({ product }: { product: Product }) {
  // Re-render when an async ads re-fetch (window change) merges fresh Meta data.
  useAdsVersion();
  const campaigns = useMemo(() => getCampaigns(product), [product]);
  const ad = adEstimates(product);
  const adsOver = isPostAds(product);
  const [paused, setPaused] = useState(adsOver);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** Live Meta overlay for this SKU; present only when the ads sync matched. */
  const live = product.adsMeta ?? null;

  const dailySpend = product.adSpend / 30;

  const toggleAll = () => {
    const next = !paused;
    setPaused(next);
    setConfirmOpen(false);
    if (next) {
      toast.warning("Campaigns paused (simulated)", {
        description: `${campaigns.length} campaigns · ${money(dailySpend)}/day spend halted.`,
      });
    } else {
      toast.success("Campaigns resumed (simulated)");
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.18, ease: EASE }}
      className="rounded-xl border border-hairline bg-panel p-5"
    >
      <h2 className="font-display text-[15px] font-semibold text-text-primary">Ad Performance</h2>
      <p className="text-[11.5px] text-text-muted">
        {live
          ? getAdsSnapshotSource() === "snapshot"
            ? "Meta · cached snapshot"
            : "Meta · live sync"
          : "Meta · lifetime"}
      </p>

      {live ? (
        <LiveAdsBody meta={live} />
      ) : campaigns.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-bright px-4 py-6 text-center">
          <p className="text-[12.5px] font-medium text-text-secondary">No campaigns yet</p>
          <p className="mt-1 text-[11.5px] text-text-muted">
            Launch a seeding campaign once the Odoo listing is ready.
          </p>
        </div>
      ) : (
        <>
          {adsOver && (
            <div className="mt-3 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-[11.5px] leading-snug text-amber">
              Ads stopped — orders are organic-only now. Campaign history below.
            </div>
          )}

          {/* Mini stats */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              { label: "Spend", node: <CountUp value={product.adSpend} format={money} /> },
              { label: "ROAS", node: <CountUp value={product.roas ?? 0} decimals={2} /> },
              { label: "CAC", node: <CountUp value={ad.cac ?? 0} format={money2} /> },
            ].map((s) => (
              <div key={s.label} className="rounded-lg bg-inset px-2.5 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[1px] text-text-muted">{s.label}</p>
                <p
                  className="mt-0.5 font-mono text-[15px] font-semibold tnum"
                  style={{
                    color:
                      s.label === "ROAS" && product.roas != null && product.roas > 2.5
                        ? "#4ADE80"
                        : "#E9EFF5",
                  }}
                >
                  {s.node}
                </p>
              </div>
            ))}
          </div>

          {/* Campaign list */}
          <div className="mt-3 flex flex-col gap-2">
            {campaigns.map((c, i) => (
              <CampaignCard key={c.id} campaign={c} paused={paused} index={i} />
            ))}
          </div>

          {/* Pause all */}
          <button
            onClick={() => (paused ? toggleAll() : setConfirmOpen(true))}
            className={cn(
              "mt-3 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] font-semibold transition-all duration-300",
              paused
                ? "border-amber/40 bg-amber/10 text-amber hover:bg-amber/15"
                : "border-hairline text-text-secondary hover:border-bright hover:text-text-primary"
            )}
          >
            {paused ? <PlayCircle className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
            {paused ? "Resume all campaigns" : "Pause all campaigns"}
          </button>
        </>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Pause all campaigns?</DialogTitle>
            <DialogDescription>
              This halts {money(dailySpend)}/day of spend across {campaigns.length} campaigns
              for {product.name}. MVP stub — nothing is sent to Meta.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <button
              onClick={() => setConfirmOpen(false)}
              className="rounded-lg border border-hairline px-3 py-1.5 text-[13px] font-semibold text-text-secondary transition-colors hover:border-bright hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              onClick={toggleAll}
              className="rounded-lg bg-amber px-3 py-1.5 text-[13px] font-semibold text-abyss transition-transform active:scale-95 hover:brightness-110"
            >
              Pause campaigns
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.section>
  );
}

export default AdPerformance;
