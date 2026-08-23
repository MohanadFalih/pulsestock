import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  Calendar,
  Check,
  ChevronDown,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { getAllAlerts, getProduct, globalKpis, products } from "@/data/products";
import { SEVERITY_META } from "@/data/decisionEngine";
import { isLiveMode, loadLiveData } from "@/data/liveSync";
import {
  setWindowDays,
  useWindowDays,
  WINDOW_OPTIONS,
} from "@/data/windowStore";
import { StageBadge } from "@/components/StageBadge";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const DATE_RANGES = WINDOW_OPTIONS;

/** How many real alerts the bell dropdown lists (badge shows the true total). */
const BELL_LIST_LIMIT = 8;

function useBreadcrumb(): string[] {
  const { pathname } = useLocation();
  if (pathname === "/") return ["Overview"];
  if (pathname === "/products") return ["Products"];
  if (pathname.startsWith("/products/")) {
    // Topbar renders outside <Routes>, so parse the id from the path.
    const id = pathname.split("/")[2];
    const p = id ? getProduct(id) : undefined;
    return ["Products", p?.name ?? "…"];
  }
  if (pathname === "/decisions") return ["Decisions"];
  if (pathname === "/ads") return ["Ads"];
  return ["PulseStock"];
}

export function Topbar() {
  const navigate = useNavigate();
  const crumbs = useBreadcrumb();
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Global window store — drives every consuming page, not just this label.
  const range = useWindowDays();
  const [syncing, setSyncing] = useState(false);

  // ⌘K / Ctrl-K opens the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sync = () => {
    if (syncing) return;
    setSyncing(true);
    if (!isLiveMode()) {
      window.setTimeout(() => {
        setSyncing(false);
        toast.success(`Synced ${globalKpis.totalProducts} products from Odoo`, {
          description: "Inventory, ads and returns are up to date.",
        });
      }, 700);
      return;
    }
    // Live mode: re-fetch the Odoo snapshot, then reload so every module
    // re-derives from the fresh dataset.
    void loadLiveData().then((ok) => {
      if (ok) {
        toast.success("Odoo snapshot refreshed — reloading");
      } else {
        toast.error("Sync failed — keeping current data");
      }
      window.location.reload();
    });
  };

  const commandItems = useMemo(() => products, []);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-hairline bg-surface/85 px-6 backdrop-blur">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[13px] text-text-secondary" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-text-muted">›</span>}
            <span className={i === crumbs.length - 1 ? "text-text-primary font-medium" : undefined}>
              {c}
            </span>
          </span>
        ))}
      </nav>

      {/* Command search */}
      <button
        onClick={() => setPaletteOpen(true)}
        className="ml-2 flex h-8 w-[320px] items-center gap-2 rounded-lg border border-hairline bg-inset px-3 text-[12.5px] text-text-muted transition-colors hover:border-bright"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search products, SKUs…</span>
        <kbd className="rounded border border-hairline bg-panel px-1.5 py-px font-mono text-[10px] text-text-muted">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        {/* Date range pill */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-8 items-center gap-2 rounded-lg border border-hairline bg-panel px-3 text-[12.5px] font-medium text-text-secondary transition-colors hover:border-bright hover:text-text-primary">
              <Calendar className="h-3.5 w-3.5" />
              Last {range} days
              <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            {DATE_RANGES.map((d) => (
              <DropdownMenuItem key={d} onClick={() => setWindowDays(d)} className="flex items-center justify-between text-[12.5px]">
                Last {d} days
                {range === d && <Check className="h-3.5 w-3.5 text-lime" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Sync button */}
        <button
          onClick={sync}
          className="flex h-8 items-center gap-2 rounded-lg bg-lime px-3 text-[13px] font-semibold text-abyss transition-transform active:scale-95 hover:brightness-110"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
          Sync Odoo
        </button>

        {/* Alerts bell — real alerts from the decision engine */}
        {(() => {
          const realAlerts = getAllAlerts();
          const topAlerts = realAlerts.slice(0, BELL_LIST_LIMIT);
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-panel text-text-secondary transition-colors hover:border-bright hover:text-text-primary"
                  aria-label="Alerts"
                >
                  <Bell className="h-4 w-4" />
                  {realAlerts.length > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber px-1 font-mono text-[9.5px] font-bold text-abyss">
                      {realAlerts.length > 99 ? "99+" : realAlerts.length}
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[320px] p-1">
                <p className="px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted">
                  Alerts · {realAlerts.length} active
                </p>
                {topAlerts.map((a) => {
                  const p = getProduct(a.productId);
                  return (
                    <DropdownMenuItem
                      key={a.id}
                      onClick={() => navigate(`/products/${a.productId}`)}
                      className="flex cursor-pointer items-start gap-2.5 px-2.5 py-2"
                    >
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: SEVERITY_META[a.severity].color }}
                      />
                      <span className="min-w-0">
                        <span className="block text-[12.5px] leading-snug text-text-primary">
                          {p?.name ?? a.productId} — {a.title}
                        </span>
                        <span className="block text-[11px] text-text-muted">
                          {SEVERITY_META[a.severity].label}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  );
                })}
                {realAlerts.length > BELL_LIST_LIMIT && (
                  <DropdownMenuItem
                    onClick={() => navigate("/decisions")}
                    className="cursor-pointer justify-center px-2.5 py-2 text-[12.5px] font-medium text-lime"
                  >
                    View all {realAlerts.length} in Decisions →
                  </DropdownMenuItem>
                )}
                {realAlerts.length === 0 && (
                  <p className="px-2.5 py-3 text-[12.5px] text-text-muted">
                    All clear — no active alerts.
                  </p>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })()}

        {/* Avatar */}
        <img
          src="/avatar.png"
          alt="Maya K."
          className="h-8 w-8 rounded-full border border-hairline object-cover"
        />
      </div>

      {/* Command palette */}
      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen} title="Search products" description="Fuzzy search across all tracked products">
        <CommandInput placeholder="Search products, SKUs…" />
        <CommandList>
          <CommandEmpty>No products found.</CommandEmpty>
          <CommandGroup heading="Products">
            {commandItems.map((p) => (
              <CommandItem
                key={p.id}
                value={`${p.name} ${p.sku} ${p.category}`}
                onSelect={() => {
                  setPaletteOpen(false);
                  navigate(`/products/${p.id}`);
                }}
                className="flex items-center gap-3"
              >
                <img src={p.thumbnail} alt="" className="h-7 w-7 rounded-md border border-hairline object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-text-primary">{p.name}</span>
                  <span className="block font-mono text-[11px] text-text-muted tnum">{p.sku} · {p.category}</span>
                </span>
                <StageBadge stage={p.stage} />
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </header>
  );
}

export default Topbar;
