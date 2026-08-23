import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export interface LayoutProps {
  children: ReactNode;
}

/**
 * App shell: fixed sidebar (232px, collapsible to 64px) + sticky 56px topbar +
 * content slot with dotted-grid backdrop and aurora header glow.
 * Content slot uses the {children} pattern — App.tsx renders
 * <Layout><Routes>…</Routes></Layout>.
 */
export function Layout({ children }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-[100dvh] bg-abyss">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <motion.div
        animate={{ paddingLeft: collapsed ? 64 : 232 }}
        transition={{ type: "spring", stiffness: 380, damping: 36 }}
        className="flex min-h-[100dvh] flex-col"
      >
        <Topbar />
        <main className="relative flex-1">
          {/* Dotted-grid backdrop, fades toward bottom */}
          <div className="dotted-grid pointer-events-none absolute inset-0" aria-hidden />
          {/* Aurora glow behind the page header */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
            className="aurora pointer-events-none absolute inset-x-0 top-0 h-[280px]"
            aria-hidden
          />
          <div className="relative mx-auto max-w-[1480px] px-6 pt-6 pb-12">
            {children}
          </div>
        </main>
      </motion.div>
    </div>
  );
}

export default Layout;
