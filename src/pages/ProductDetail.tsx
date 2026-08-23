import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { getProduct, type Product } from "@/data/products";
import { useAdsVersion } from "@/data/windowStore";
import { ActionPanel } from "@/sections/product-detail/ActionPanel";
import { AdPerformance } from "@/sections/product-detail/AdPerformance";
import { AuditTrail } from "@/sections/product-detail/AuditTrail";
import { LifecycleTimeline } from "@/sections/product-detail/LifecycleTimeline";
import { ProductHeader } from "@/sections/product-detail/ProductHeader";
import { SalesReturnsChart } from "@/sections/product-detail/SalesReturnsChart";
import { StockChart } from "@/sections/product-detail/StockChart";
import { SupplierPanel } from "@/sections/product-detail/SupplierPanel";
import { VitalsCard } from "@/sections/product-detail/VitalsCard";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Route-load skeleton: header block + two chart wells (600ms). */
function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading product">
      <Skeleton className="h-[136px] w-full rounded-xl" />
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 flex flex-col gap-4 lg:col-span-8">
          <Skeleton className="h-[240px] w-full rounded-xl" />
          <Skeleton className="h-[300px] w-full rounded-xl" />
        </div>
        <div className="col-span-12 lg:col-span-4">
          <Skeleton className="h-[420px] w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function DetailBody({ product }: { product: Product }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="flex flex-col gap-4"
    >
      <ProductHeader product={product} />

      <div className="grid grid-cols-12 items-start gap-4">
        {/* Main column: timeline + charts */}
        <div className="col-span-12 flex flex-col gap-4 lg:col-span-8">
          <LifecycleTimeline product={product} />
          <StockChart product={product} />
          <SalesReturnsChart product={product} />
        </div>

        {/* Right rail: sticky vitals + supplier + ads + actions */}
        <div className="col-span-12 flex flex-col gap-4 lg:sticky lg:top-20 lg:col-span-4">
          <VitalsCard product={product} />
          <SupplierPanel product={product} />
          <AdPerformance product={product} />
          <ActionPanel product={product} />
        </div>
      </div>

      <AuditTrail product={product} />
    </motion.div>
  );
}

/**
 * Product Detail (`/products/:id`) — lifecycle deep dive.
 * Accepts a product id (`pld-001`…`pld-014`) or SKU (`PLD-002`).
 */
export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // Re-resolve the product when an async ads/live re-fetch swaps the dataset
  // in place (no page reload on window changes).
  useAdsVersion();
  const product = id ? getProduct(id) : undefined;

  // 600ms route-load skeleton; derived so no synchronous setState in effects.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setLoadedId(id ?? null), 600);
    return () => window.clearTimeout(t);
  }, [id]);
  const loading = loadedId !== id;

  if (!product) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
      >
        <EmptyState
          title="Product not found"
          message={`"${id ?? ""}" isn't in the Odoo sync. It may have been archived or never imported.`}
          ctaLabel="Back to Products"
          onCta={() => navigate("/products")}
        />
      </motion.div>
    );
  }

  if (loading) return <DetailSkeleton />;

  // key resets per-section local state (timeline selection, pause, checklist)
  // when navigating between products without unmounting the route.
  return <DetailBody key={product.id} product={product} />;
}
