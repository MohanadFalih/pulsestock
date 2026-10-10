#!/usr/bin/env python3
"""Builds public/data/campaigns.json — daily campaign-level Meta performance
(last 7 days including today) for every ACTIVE campaign in the ad account.

Fetches the Meta Marketing API directly from the GitHub Actions sync job
(credentials via repo secrets META_ACCESS_TOKEN / META_AD_ACCOUNT_ID).

Deliberately a SEPARATE file from ad-brief.json: stable URL, independent
schema, zero risk to the existing morning reader that depends on the brief.

Null semantics (documented in the file itself):
  - purchases / conversations / landingPageViews are null when that metric
    family does not apply to the campaign's objective AND had zero events
    (e.g. purchases=null for a traffic campaign). A real zero (a sales
    campaign with no purchases today) is reported as 0, not null.
  - A missing date inside a campaign's "daily" list means zero delivery
    that day.
  - campaigns=[] with error!=null means the Meta fetch failed — check the
    Actions logs and the token secret.
"""
import datetime as dt
import json
import os
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "public", "data")

API_VERSION = "v21.0"
BASE = f"https://graph.facebook.com/{API_VERSION}"

TOKEN = os.environ.get("META_ACCESS_TOKEN", "").strip()
ACCOUNT = os.environ.get("META_AD_ACCOUNT_ID", "").strip().replace("act_", "")

PURCHASE_TYPES = {"purchase", "offsite_conversion.fb_pixel_purchase"}
SALES_OBJECTIVES = {"OUTCOME_SALES", "OUTCOME_LEADS", "CONVERSIONS",
                    "PRODUCT_CATALOG_SALES", "OUTCOME_ENGAGEMENT"}
MESSAGE_OBJECTIVES = {"OUTCOME_MESSAGES", "MESSAGES"}
TRAFFIC_OBJECTIVES = {"OUTCOME_TRAFFIC", "LINK_CLICKS", "TRAFFIC"}


def get_all(path, params):
    """GET with cursor-pagination; returns the concatenated data list."""
    params = dict(params, access_token=TOKEN)
    url = f"{BASE}/{path}?{urllib.parse.urlencode(params)}"
    rows = []
    while url:
        req = urllib.request.Request(url, headers={"User-Agent": "pulsestock-campaigns/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.load(resp)
        if "error" in payload:
            raise RuntimeError(payload["error"].get("message", "meta api error"))
        rows.extend(payload.get("data", []))
        url = payload.get("paging", {}).get("next")
    return rows


def action_sum(actions, predicate):
    total = 0.0
    for a in actions or []:
        if predicate(a.get("action_type", "")):
            try:
                total += float(a.get("value", 0))
            except (TypeError, ValueError):
                pass
    return total


def main():
    today = dt.date.today()
    since = today - dt.timedelta(days=6)
    now = dt.datetime.now(dt.timezone.utc).isoformat()

    out = {
        "syncedAt": now,
        "metaSyncedAt": now,
        "window": {"since": since.isoformat(), "until": today.isoformat(), "days": 7},
        "tz": "dates are in the ad account timezone as returned by Meta",
        "currency": "USD",
        "note": ("One entry per ACTIVE campaign; 'daily' holds one row per date "
                 "with delivery (missing date = zero delivery). null means the "
                 "metric family does not apply to this campaign objective "
                 "(purchases=null for traffic, conversations=null for catalog "
                 "sales, ...). A real zero stays 0. error!=null means the Meta "
                 "fetch failed (expired/invalid token) — data may be stale."),
        "error": None,
        "campaigns": [],
    }

    if not TOKEN or not ACCOUNT:
        out["error"] = "missing META_ACCESS_TOKEN or META_AD_ACCOUNT_ID secret"
        write(out)
        return

    try:
        campaigns = get_all(f"act_{ACCOUNT}/campaigns", {
            "fields": "id,name,status,objective,daily_budget",
            "effective_status": '["ACTIVE"]',
            "limit": "200",
        })
        insights = get_all(f"act_{ACCOUNT}/insights", {
            "level": "campaign",
            "time_increment": "1",
            "time_range": json.dumps({"since": since.isoformat(),
                                      "until": today.isoformat()}),
            "fields": "campaign_id,campaign_name,spend,impressions,ctr,actions",
            "limit": "500",
        })
    except Exception as exc:
        out["error"] = f"meta api fetch failed: {exc}"
        write(out)
        return

    by_id = {}
    for c in campaigns:
        by_id[c["id"]] = {
            "id": c["id"],
            "name": c.get("name"),
            "status": c.get("status"),
            "objective": c.get("objective"),
            "dailyBudgetUSD": (round(float(c["daily_budget"]) / 100.0, 2)
                               if c.get("daily_budget") else None),
            "daily": [],
        }

    for row in insights:
        cid = row.get("campaign_id")
        if cid not in by_id:
            # delivering but not returned by the campaigns endpoint (rare)
            by_id[cid] = {"id": cid, "name": row.get("campaign_name"),
                          "status": None, "objective": None,
                          "dailyBudgetUSD": None, "daily": []}
        camp = by_id[cid]
        obj = camp.get("objective") or ""

        spend = float(row.get("spend") or 0)
        actions = row.get("actions")
        n_purch = action_sum(actions, lambda t: t in PURCHASE_TYPES)
        n_conv = action_sum(actions, lambda t: "messaging_conversation_started" in t)
        n_lpv = action_sum(actions, lambda t: t == "landing_page_view")

        def metric(count, objective_set):
            if count > 0 or obj in objective_set:
                return int(count)
            return None

        def cost(count):
            return round(spend / count, 2) if count else None

        purchases = metric(n_purch, SALES_OBJECTIVES)
        convos = metric(n_conv, MESSAGE_OBJECTIVES)
        lpv = metric(n_lpv, TRAFFIC_OBJECTIVES)

        camp["daily"].append({
            "date": row.get("date_start"),
            "spendUSD": round(spend, 2),
            "purchases": purchases,
            "costPerPurchaseUSD": cost(n_purch) if purchases is not None else None,
            "conversations": convos,
            "costPerConversationUSD": cost(n_conv) if convos is not None else None,
            "landingPageViews": lpv,
            "costPerLpvUSD": cost(n_lpv) if lpv is not None else None,
            "impressions": int(row.get("impressions") or 0),
            "ctrPct": round(float(row.get("ctr") or 0), 2),
        })

    for camp in by_id.values():
        camp["daily"].sort(key=lambda d: d["date"] or "")
    out["campaigns"] = sorted(by_id.values(), key=lambda c: (c["name"] or ""))
    write(out)


def write(out):
    path = os.path.join(DATA_DIR, "campaigns.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"campaigns.json: {len(out['campaigns'])} campaigns, "
          f"error={out['error']}")


if __name__ == "__main__":
    main()
