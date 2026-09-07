import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Boxes,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Megaphone,
  Package,
  Settings,
  Truck,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { globalKpis } from "@/data/products";
import { isLiveMode, liveSyncLabel } from "@/data/liveSync";
import { getAdsSnapshot, isAdsOffline } from "@/data/adsProvider";
import { useAdsVersion } from "@/data/windowStore";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Small count chip on the right. */
  count?: number;
  /** Chip tone; amber = needs action. */
  countTone?: "lime" | "amber";
  disabled?: boolean;
}

function navItems(): NavItem[] {
  return [
    { label: "Overview", to: "/", icon: LayoutDashboard },
    { label: "Products", to: "/products", icon: Package, count: globalKpis.totalProducts },
    { label: "Decisions", to: "/decisions", icon: Zap, count: globalKpis.needsAttention, countTone: "amber" },
    { label: "Ads", to: "/ads", icon: Megaphone, count: getAdsSnapshot()?.summary.totalAds },
    { label: "Daily Tasks", to: "/tasks", icon: ListChecks },
    { label: "Finance", to: "/finance", icon: Wallet },
    { label: "Inventory", to: "/inventory", icon: Boxes },
    { label: "Suppliers", to: "/suppliers", icon: Truck, disabled: true },
    { label: "Settings", to: "/settings", icon: Settings, disabled: true },
  ];
}

function isItemActive(to: string, pathname: string): boolean {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { pathname } = useLocation();
  const [pulse] = useState(true);
  // Re-render the ads pill/count when a fresh ads fetch lands in place.
  useAdsVersion();
  const items = navItems();
  const syncLabel = isLiveMode() ? `Odoo · ${liveSyncLabel()}` : "Odoo · mock data";

  return (
    <TooltipProvider delayDuration={150}>
      <motion.aside
        animate={{ width: collapsed ? 64 : 232 }}
        transition={{ type: "spring", stiffness: 380, damping: 36 }}
        className="fixed inset-y-0 left-0 z-40 flex flex-col border-r border-hairline bg-surface"
      >
        {/* Logo + sync pill */}
        <div className={cn("flex items-center gap-2.5 px-4 pt-5", collapsed && "justify-center px-0")}>
          <img src="/logo.svg" alt="PulseStock" className="h-7 w-7 shrink-0" />
          {!collapsed && (
            <span className="font-display text-[16px] font-bold tracking-tight text-text-primary">
              Pulse<span className="text-lime">Stock</span>
              <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-lime align-middle" />
            </span>
          )}
        </div>
        {!collapsed && (
          <div className="mx-4 mt-4 flex items-center gap-2 rounded-full border border-hairline bg-inset px-3 py-1.5">
            <span className="relative flex h-1.5 w-1.5">
              {pulse && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pos opacity-60" />
              )}
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-pos" />
            </span>
            <span className="text-[11.5px] text-text-muted">{syncLabel}</span>
          </div>
        )}
        {/* Quiet Meta ads indicator — only surfaces when the endpoint is down. */}
        {!collapsed && isAdsOffline() && (
          <div className="mx-4 mt-1.5 flex items-center gap-2 rounded-full border border-hairline bg-inset px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-amber" />
            <span className="text-[11.5px] text-text-muted">Meta · ads offline</span>
          </div>
        )}

        {/* Nav */}
        <nav className={cn("mt-6 flex flex-1 flex-col gap-1 px-3", collapsed && "items-center px-2")}>
          {items.map((item) => {
            const active = !item.disabled && isItemActive(item.to, pathname);
            const Icon = item.icon;
            const content = (
              <div
                className={cn(
                  "relative flex w-full items-center gap-3 rounded-lg py-2 text-[13.5px] font-medium transition-colors duration-150",
                  collapsed ? "justify-center px-0" : "px-3",
                  item.disabled
                    ? "cursor-not-allowed text-text-muted/50"
                    : active
                      ? "bg-lime-dim text-text-primary"
                      : "text-text-secondary hover:bg-panel-hover hover:text-text-primary"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-lime"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
                <Icon
                  className={cn(
                    "h-[18px] w-[18px] shrink-0 transition-transform duration-150",
                    active ? "text-lime" : "group-hover:translate-x-0.5",
                    item.disabled && "opacity-50"
                  )}
                />
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.count != null && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-px font-mono text-[10px] font-semibold tnum",
                          item.countTone === "amber"
                            ? "bg-amber/15 text-amber"
                            : "bg-panel text-text-muted"
                        )}
                      >
                        {item.count}
                      </span>
                    )}
                    {item.disabled && (
                      <span className="rounded-full border border-hairline px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-text-muted/60">
                        soon
                      </span>
                    )}
                  </>
                )}
              </div>
            );

            const inner = item.disabled ? (
              <div className="group w-full" aria-disabled>{content}</div>
            ) : (
              <NavLink to={item.to} end={item.to === "/"} className="group w-full" tabIndex={-1}>
                {content}
              </NavLink>
            );

            return collapsed ? (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>{inner}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            ) : (
              <div key={item.label}>{inner}</div>
            );
          })}
        </nav>

        {/* Bottom: collapse toggle + user chip */}
        <div className={cn("px-3 pb-4", collapsed && "px-2")}>
          <button
            onClick={onToggle}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium text-text-muted transition-colors hover:bg-panel-hover hover:text-text-secondary",
              collapsed && "justify-center px-0"
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronsLeft className="h-4 w-4" />
                Collapse
              </>
            )}
          </button>
          <div className="my-3 h-px bg-hairline" />
          <div
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2 py-1.5",
              collapsed && "justify-center px-0"
            )}
          >
            <img src="/avatar.png" alt="Maya K." className="h-7 w-7 shrink-0 rounded-full border border-hairline object-cover" />
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-semibold text-text-primary">Maya K.</p>
                  <p className="truncate text-[11px] text-text-muted">Store operator</p>
                </div>
                <button
                  className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-panel-hover hover:text-text-secondary"
                  aria-label="Log out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </motion.aside>
    </TooltipProvider>
  );
}

export default Sidebar;
