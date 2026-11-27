#!/usr/bin/env python3
"""TEMP read-only diag for the resale morning report 2026-11-27. Never writes to Odoo."""
import csv, io, json, os, re, sys, urllib.request
from collections import Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo, load_env, ENV_PATH  # noqa

o = Odoo(load_env(ENV_PATH))
R = {}
def q(name, fn):
    try:
        R[name] = fn()
    except Exception as e:
        R[name] = {"error": str(e)[:400]}

SHEET = ("https://docs.google.com/spreadsheets/d/1EaE2karm7nAJ5YoNPuBQdWND1t5fSufRlnoyFukZt5g"
         "/export?format=csv&gid=0")
OPEN = ["active", "due", "floor"]
F = ["display_code", "feed_code", "state", "step_no", "qty", "current_price", "base_price",
     "cdn_url", "cdn_pending", "cdn_error", "cdn_file_id", "product_tmpl_id", "cost_issue"]
items = o.kw("deniz.clearance.item", "search_read", [[["state", "in", OPEN + ["suggested"]]]], {"fields": F})
liq = []
try:
    liq = o.kw("deniz.liquidation.item", "search_read", [[["state", "=", "live"]]],
               {"fields": ["feed_id", "code", "qty_free", "availability", "sale_price", "old_price",
                           "cdn_url", "cdn_error", "product_tmpl_id"]})
except Exception as e:
    R["liq_error"] = str(e)[:300]

def step0():
    xs = [i for i in items if i["state"] in OPEN and i["step_no"] == 0 and i["current_price"]
          and i["current_price"] >= i["base_price"]]
    return {"lines": len(xs), "pieces": sum(i["qty"] for i in xs),
            "models": len({i["product_tmpl_id"][0] for i in xs if i["product_tmpl_id"]}),
            "withCdn": len([i for i in xs if i["cdn_url"]]),
            "pending": [i["display_code"] for i in xs if not i["cdn_url"] and i["cdn_pending"]],
            "noFile": [i["display_code"] for i in xs if not i["cdn_url"] and not i["cdn_pending"]],
            "errors": [(i["display_code"], i["cdn_error"]) for i in xs if i["cdn_error"]]}
q("step0", step0)
q("allCdn", lambda: {"open": len([i for i in items if i["state"] in OPEN]),
                     "openNoCdn": [(i["display_code"], i["step_no"], i["cdn_pending"], i["cdn_error"])
                                   for i in items if i["state"] in OPEN and not i["cdn_url"]][:40],
                     "costIssue": Counter(i["cost_issue"] or "-" for i in items if i["state"] in OPEN)})

def sheet():
    with urllib.request.urlopen(SHEET, timeout=60) as r:
        rows = list(csv.DictReader(io.StringIO(r.read().decode("utf-8"))))
    by_feed = {}
    for i in items:
        if i["feed_code"]:
            by_feed.setdefault(i["feed_code"], []).append(i)
    liq_by = {l["feed_id"]: l for l in liq if l.get("feed_id")}
    bad, unknown, n = [], [], 0
    for r in rows:
        if (r.get("availability") or "").strip() != "in stock":
            continue
        n += 1
        rid = (r.get("id") or "").strip()
        if rid in by_feed:
            if not any(i["state"] in OPEN and i["qty"] > 0 for i in by_feed[rid]):
                bad.append([rid, "resale", [(i["state"], i["qty"]) for i in by_feed[rid]]])
        elif rid in liq_by:
            if (liq_by[rid].get("qty_free") or 0) <= 0:
                bad.append([rid, "lastpiece", liq_by[rid].get("qty_free")])
        else:
            unknown.append(rid)
    return {"rows": len(rows), "inStock": n, "inStockNoStock": bad[:60], "nBad": len(bad),
            "unknownIds": unknown[:60], "nUnknown": len(unknown)}
q("sheet", sheet)
q("liqLive", lambda: {"n": len(liq), "zeroQty": [l["feed_id"] for l in liq if (l.get("qty_free") or 0) <= 0][:40],
                      "cdnErr": [(l["feed_id"], l["cdn_error"]) for l in liq if l.get("cdn_error")][:20]})
q("oneprice_on", lambda: [(t["default_code"] or t["name"], t["purchase_ok"]) for t in o.kw(
    "product.template", "search_read", [[["deniz_oneprice_on", "=", True]]],
    {"fields": ["name", "default_code", "purchase_ok"], "context": {"active_test": False}})])
q("crons", lambda: o.kw("ir.cron", "search_read",
    [["|", "|", "|", ["cron_name", "ilike", "clear"], ["cron_name", "ilike", "تصفية"],
      ["cron_name", "ilike", "بيع"], ["cron_name", "ilike", "resale"]]],
    {"fields": ["cron_name", "active", "lastcall", "nextcall", "failure_count"], "context": {"active_test": False}}))

def channel():
    cid = o.kw("ir.config_parameter", "get_param", ["deniz_clearance.channel_id"])
    if not cid:
        return None
    msgs = o.kw("mail.message", "search_read", [[["model", "=", "discuss.channel"], ["res_id", "=", int(cid)]]],
                {"fields": ["date", "body"], "order": "id desc", "limit": 4})
    return [(m["date"], re.sub(r"<[^>]+>", " ", m["body"] or "")[:900]) for m in msgs]
q("channel", channel)

print("DIAG_JSON_BEGIN")
print(json.dumps(R, ensure_ascii=False, default=str))
print("DIAG_JSON_END")
