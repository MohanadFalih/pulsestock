#!/usr/bin/env python3
"""Builds public/data/ad-brief.json — a compact per-SKU decision file that
merges Odoo lifecycle data (live.json, produced by odoo_sync.py minutes
earlier) with live Meta ad performance from the Ads-Dashboard bridge.

v1.2 — additive only: meta.campaigns[] lists every active campaign touching
the SKU (campaignName, objective, spend3dUSD, purchases3d). Objectives are
resolved from campaigns.json (built by meta_campaigns.py in the same job).
v1.2 adds ad identity per campaign entry: "adName" (string) when one ad of
the campaign shows the SKU; when several ads of the same campaign show it,
"adName" is null and "ads" lists {adName, spend3dUSD} per ad.
No existing field was renamed, removed, or retyped.

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


def load_campaign_objectives():
    """campaign name -> objective map from campaigns.json (previous/this run).
    Missing file or parse error -> empty map (objective becomes null)."""
    try:
        with open(os.path.join(DATA_DIR, "campaigns.json"), encoding="utf-8") as f:
            data = json.load(f)
        return {c.get("name"): c.get("objective")
                for c in data.get("campaigns", []) if c.get("name")}
    except Exception as exc:
        print(f"campaigns.json unavailable for objectives (continuing): {exc}")
        return {}


def fetch_bridge():
    """Returns the bridge payload, or None if unreachable (brief still built)."""
    try:
        req = urllib.request.Request(BRIDGE_URL, headers={"User-Agent": "pulsestock-brief/1.1"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.load(resp)
    except Exception as exc:  # bridge offline/slow — keep Odoo-only brief
        print(f"bridge fetch failed (continuing without Meta data): {exc}")
        return None


def _ad_name(ad):
    """Best-effort ad name from a bridge per-ad row (null if absent)."""
    for key in ("adName", "name", "ad_name"):
        v = ad.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def build_campaigns(ads_list, objective_by_name):
    """Aggregate the bridge's per-ad rows into per-campaign summary entries."""
    agg = {}
    for ad in ads_list or []:
        cname = ad.get("campaign")
        if not cname:
            continue
        entry = agg.setdefault(cname, {"spend": 0.0, "purch": 0, "ads": []})
        spent = 0.0
        try:
            spent = float(ad.get("spent") or 0)
            entry["spend"] += spent
        except (TypeError, ValueError):
            pass
        try:
            entry["purch"] += int(ad.get("purchases") or 0)
        except (TypeError, ValueError):
            pass
        entry["ads"].append({"adName": _ad_name(ad), "spend3dUSD": round(spent, 2)})
    campaigns = []
    for cname in sorted(agg):
        e = agg[cname]
        item = {
            "campaignName": cname,
            "objective": objective_by_name.get(cname),   # null if unknown
            "spend3dUSD": round(e["spend"], 2),
            "purchases3d": e["purch"] if e["purch"] > 0 else None,
        }
        if len(e["ads"]) == 1:
            item["adName"] = e["ads"][0]["adName"]       # string or null
        else:
            item["adName"] = None                        # see "ads" instead
            item["ads"] = e["ads"]                       # [{adName, spend3dUSD}, ...]
        campaigns.append(item)
    return campaigns


def main():
    live = load_live()
    bridge = fetch_bridge()
    objective_by_name = load_campaign_objectives()

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
                    "campaigns": build_campaigns(ap.get("ads"), objective_by_name),
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
        "note": "meta=null means the Meta bridge detected no active ad for this SKU in its last-3-days window. "
                "meta.campaigns[] lists the active campaigns behind that SKU "
                "(objective=null means the campaign was not found in campaigns.json). "
                "Per campaign entry: adName is the showing ad's name, or null when several ads "
                "of that campaign show the SKU — then ads[] lists {adName, spend3dUSD} per ad.",
        "products": items,
    }

    out_path = os.path.join(DATA_DIR, "ad-brief.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(brief, f, ensure_ascii=False, separators=(",", ":"))
    total_campaign_links = sum(len(m["campaigns"]) for m in ads_by_sku.values())
    print(f"ad-brief.json: {len(items)} products, {len(ads_by_sku)} SKUs with Meta data, "
          f"{total_campaign_links} campaign links, metaSyncedAt={meta_synced_at}")


if __name__ == "__main__":
    main()
