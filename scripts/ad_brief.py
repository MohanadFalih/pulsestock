#!/usr/bin/env python3
"""Builds public/data/ad-brief.json — a compact per-SKU decision file that
merges Odoo lifecycle data (live.json, produced by odoo_sync.py minutes
earlier) with live Meta ad performance from the Ads-Dashboard bridge.

Runs right after odoo_sync.py inside the same GitHub Actions job, and its
output is committed alongside live.json — so the raw GitHub URL always
serves a fresh, single, small file for ad decisions.
"""
import json
import os
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "public", "data")
BRIDGE_URL = "https://ad-dashboard-git-main-deniz-cfb3.vercel.app/api/pulsestock"


def load_live():
    with open(os.path.join(DATA_DIR, "live.json"), encoding="utf-8") as f:
        return json.load(f)


def fetch_bridge():
    """Returns the bridge payload, or None if unreachable (brief still built)."""
    try:
        req = urllib.request.Request(BRIDGE_URL, headers={"User-Agent": "pulsestock-brief/1.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.load(resp)
    except Exception as exc:  # bridge offline/slow — keep Odoo-only brief
        print(f"bridge fetch failed (continuing without Meta data): {exc}")
        return None


def main():
    live = load_live()
    bridge = fetch_bridge()

    ads_by_sku = {}
    meta_synced_at = None
    if bridge:
        meta_synced_at = bridge.get("syncedAt")
        for ap in bridge.get("products", []):
            sku = ap.get("sku")
            if sku:
                ads_by_sku[sku] = {
                    "spend3dUSD": ap.get("spent"),
                    "purchases3d": ap.get("purchases"),
                    "roas3d": ap.get("roas"),
                    "cpa3dUSD": ap.get("cpa"),
                    "health": ap.get("health"),
                    "adCount": ap.get("adCount"),
                }

    items = []
    for p in live.get("products", []):
        delivered = p.get("delivered") or 0
        returned = p.get("returned") or 0
        items.append({
            "sku": p.get("sku"),
            "stage": p.get("stage"),                    # Odoo-inferred stage
            "created": p.get("odooCreatedDate"),
            "firstOrder": p.get("firstOrderDate"),
            "orders": p.get("orders"),
            "units": p.get("units"),
            "delivered": delivered,
            "returned": returned,
            "returnPct": round(returned / delivered * 100, 1) if delivered else 0,
            "revenueIQD": p.get("revenue"),
            "priceIQD": p.get("unitPrice"),
            "vel7d": p.get("orderVelocity7d"),          # orders/day, last 7 days
            "daysSinceOrder": p.get("daysSinceLastOrder"),
            "returnedStock": p.get("returnedStock"),
            "supplierQty": (p.get("supplierStock") or {}).get("qty"),
            "meta": ads_by_sku.get(p.get("sku")),       # null = no ad detected (last 3d)
        })

    brief = {
        "syncedAt": live.get("syncedAt"),
        "metaSyncedAt": meta_synced_at,
        "tz": "Asia/Baghdad",
        "currency": "IQD",
        "note": "meta=null means the Meta bridge detected no active ad for this SKU in its last-3-days window",
        "products": items,
    }

    out_path = os.path.join(DATA_DIR, "ad-brief.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(brief, f, ensure_ascii=False, separators=(",", ":"))
    print(f"ad-brief.json: {len(items)} products, {len(ads_by_sku)} SKUs with Meta data, "
          f"metaSyncedAt={meta_synced_at}")


if __name__ == "__main__":
    main()
