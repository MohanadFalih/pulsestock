#!/usr/bin/env python3
"""PulseStock — resale (إعادة البيع) monitoring sync. READ-ONLY against Odoo.

Writes public/data/resale.json for the «إعادة البيع» page and the owner's
morning report. Three questions it answers:

  1. Ladder state: how many colours / pieces sit at each step (0 = first
     exposure, 1..4 = cost ladder), how many wait for approval, how many
     need a cost.
  2. Step performance: for every step, how many pieces entered, how many sold
     within 14 days of entering (sell-through), days to first sale, and daily
     units sold per step. Source: deniz.resale.piece.log (one row per variant
     per step it entered) + confirmed sale.order.line, using the same matching
     rule as Odoo (sale between entry and exit, net price <= step price + 500).
  3. Price match: for every in-stock row the Meta sheet shows (published
     «قطعة أخيرة» items and live resale lines), the ad price vs the price a
     salesperson gets in Odoo on the «تصفية» pricelist. Any gap > 500 IQD is a
     mismatch the customer will feel in the chat.

Same connection and secrets as scripts/odoo_sync.py. Never writes to Odoo.
Run with --print to dump a short summary instead of writing the file.
"""

import datetime
import json
import os
import statistics
import sys
import time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo, load_env, ENV_PATH, LOCAL_TZ, local_day, log  # noqa: E402

OUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                        "public", "data", "resale.json")
LOG_DAYS = 120          # piece-log history window
DAILY_DAYS = 30         # per-step daily sales series
WINDOW = 14             # sell-through window (matches Odoo WINDOW_DAYS)
PRICE_SLACK = 500       # matches Odoo PRICE_SLACK
MISMATCH_IQD = 500
TASFIYA_NAMES = ("تصفية",)
OPEN_STATES = ["suggested", "active", "due", "floor", "paused"]
APPLIED = ("active", "due", "floor")


def chunks(seq, n=500):
    seq = list(seq)
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def read_all(odoo, model, domain, fields, ctx=None):
    kw = {"fields": fields}
    if ctx:
        kw["context"] = ctx
    return odoo.kw(model, "search_read", [domain], kw)


def m2o_id(v):
    return v[0] if isinstance(v, list) and v else (v or None)


def m2o_name(v):
    return v[1] if isinstance(v, list) and len(v) > 1 else None


def utc_now_str():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


# ── pricelist evaluation (Odoo 18 semantics, first matching rule wins) ───────
def rule_price(rule, base):
    cp = rule.get("compute_price")
    if cp == "fixed":
        return float(rule.get("fixed_price") or 0)
    if cp == "percentage":
        return base * (1 - float(rule.get("percent_price") or 0) / 100.0)
    # formula (base = list price assumed)
    price = base * (1 - float(rule.get("price_discount") or 0) / 100.0)
    price += float(rule.get("price_surcharge") or 0)
    rnd = float(rule.get("price_round") or 0)
    if rnd:
        price = round(price / rnd) * rnd
    return price


def pricelist_price(rules, variant, now):
    """rules: pre-sorted list. variant: dict(id, tmpl, categ_path, lst)."""
    for r in rules:
        if float(r.get("min_quantity") or 0) > 1:
            continue
        if r.get("date_start") and r["date_start"] > now:
            continue
        if r.get("date_end") and r["date_end"] < now:
            continue
        ao = r.get("applied_on")
        if ao == "0_product_variant" and m2o_id(r.get("product_id")) != variant["id"]:
            continue
        if ao == "1_product" and m2o_id(r.get("product_tmpl_id")) != variant["tmpl"]:
            continue
        if ao == "2_product_category" and m2o_id(r.get("categ_id")) not in variant["categs"]:
            continue
        return rule_price(r, variant["lst"]), r
    return variant["lst"], None


SHEET_CSV = ("https://docs.google.com/spreadsheets/d/1EaE2karm7nAJ5YoNPuBQdWND1t5fSufRlnoyFukZt5g"
             "/export?format=csv&gid=0")


def norm(s):
    return "".join(ch for ch in str(s).upper() if ch.isascii() and ch.isalnum())


def iqd(v):
    digits = "".join(ch for ch in str(v or "") if ch.isdigit())
    return float(digits) if digits else 0.0


def fetch_sheet():
    """META LIQU feed sheet (the Meta catalogue source) as dict rows."""
    import csv
    import io
    import urllib.request
    with urllib.request.urlopen(os.environ.get("META_LIQU_CSV", SHEET_CSV), timeout=60) as r:
        text = r.read().decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(text)))
    log(f"sheet rows: {len(rows)}")
    return [{"id": (r.get("id") or "").strip(), "availability": (r.get("availability") or "").strip(),
             "price": iqd(r.get("price")), "sale_price": iqd(r.get("sale_price")),
             "label": (r.get("custom_label_0") or "").strip()} for r in rows if r.get("id")]


def main():
    t0 = time.time()
    printing = "--print" in sys.argv
    odoo = Odoo(load_env(ENV_PATH))
    today = datetime.datetime.now(LOCAL_TZ).date()
    now = utc_now_str()

    # ── 1. ladder lines ─────────────────────────────────────────────────────
    item_fields = ["display_code", "product_tmpl_id", "color_value_id", "state", "step_no",
                   "proposed_step_no", "current_price", "proposed_price", "base_price",
                   "cost_price", "manual_price", "model_idle_days", "shown_days", "off_season",
                   "cost_issue", "qty", "variant_ids", "entered_on", "stage_start",
                   "next_review", "applied_at", "rule_id"]
    items = read_all(odoo, "deniz.clearance.item", [["state", "in", OPEN_STATES]], item_fields)
    log(f"clearance items: {len(items)}")

    # ── 2. piece log (per variant per step) ────────────────────────────────
    since = (today - datetime.timedelta(days=LOG_DAYS)).isoformat()
    logs = read_all(odoo, "deniz.resale.piece.log",
                    ["|", ["date_exit", "=", False], ["date_entry", ">=", since]],
                    ["item_id", "product_id", "product_tmpl_id", "display_code", "step", "price",
                     "full_price", "cost", "qty", "date_entry", "date_exit", "exit_reason",
                     "sold_qty", "sold_14", "first_sale", "last_sale"])
    log(f"piece logs: {len(logs)}")

    # confirmed sales of the logged variants (same matching rule as Odoo)
    variant_ids = sorted({m2o_id(l["product_id"]) for l in logs if l.get("product_id")})
    first_entry = min((l["date_entry"] for l in logs), default=today.isoformat())
    sales = defaultdict(list)  # variant -> [(day, qty, net)]
    for ids in chunks(variant_ids):
        for line in read_all(odoo, "sale.order.line",
                             [["product_id", "in", ids], ["order_id.state", "in", ["sale", "done"]],
                              ["product_uom_qty", ">", 0], ["display_type", "=", False],
                              ["order_id.date_order", ">=", first_entry + " 00:00:00"]],
                             ["product_id", "product_uom_qty", "price_unit", "discount", "order_id",
                              "create_date"]):
            # line creation == order placement in this shop (see odoo_sync.py)
            day = local_day(line["create_date"])
            net = float(line["price_unit"] or 0) * (1 - float(line["discount"] or 0) / 100.0)
            sales[m2o_id(line["product_id"])].append((day, float(line["product_uom_qty"] or 0), net))

    daily_from = (today - datetime.timedelta(days=DAILY_DAYS - 1)).isoformat()
    daily = defaultdict(lambda: defaultdict(float))   # day -> step -> units
    days_to_sale = defaultdict(list)
    log_rows = []
    for l in logs:
        vid = m2o_id(l["product_id"])
        entry = l["date_entry"]
        end = l["date_exit"] or today.isoformat()
        sold = [(d, q) for d, q, net in sales.get(vid, ())
                if entry <= d <= end and net <= (l["price"] or 0) + PRICE_SLACK]
        for d, q in sold:
            if d >= daily_from:
                daily[d][l["step"]] += q
        if l.get("first_sale"):
            days_to_sale[l["step"]].append(
                (datetime.date.fromisoformat(l["first_sale"]) - datetime.date.fromisoformat(entry)).days)
        log_rows.append({
            "code": l.get("display_code"), "variant": m2o_name(l.get("product_id")),
            "step": l["step"], "price": l["price"], "full": l["full_price"], "cost": l["cost"],
            "qty": l["qty"], "entry": entry, "exit": l["date_exit"] or None,
            "exitReason": l["exit_reason"] or None, "sold": l["sold_qty"], "sold14": l["sold_14"],
            "firstSale": l["first_sale"] or None,
        })

    # step stats
    steps = {}
    matured_cut = (today - datetime.timedelta(days=WINDOW)).isoformat()
    for s in range(0, 5):
        ls = [l for l in logs if l["step"] == s]
        open_ls = [l for l in ls if not l["date_exit"]]
        matured = [l for l in ls if l["date_entry"] <= matured_cut]
        m_qty = sum(l["qty"] or 0 for l in matured)
        m_sold = sum(l["sold_14"] or 0 for l in matured)
        dts = days_to_sale.get(s, [])
        steps[str(s)] = {
            "openVariants": len(open_ls),
            "openPieces": sum(l["qty"] or 0 for l in open_ls),
            "entered": sum(l["qty"] or 0 for l in ls),
            "sold": sum(l["sold_qty"] or 0 for l in ls),
            "maturedPieces": m_qty,
            "maturedSold14": m_sold,
            "sellThrough14": round(m_sold / m_qty, 3) if m_qty else None,
            "medianDaysToSale": statistics.median(dts) if dts else None,
            "soldLast7": sum(v.get(s, 0) for d, v in daily.items()
                             if d >= (today - datetime.timedelta(days=6)).isoformat()),
        }

    # ladder state summary from the lines themselves
    by_state = defaultdict(lambda: {"lines": 0, "pieces": 0})
    by_step = defaultdict(lambda: {"lines": 0, "pieces": 0, "cost": 0, "price": 0})
    item_rows = []
    for it in items:
        st = it["state"]
        by_state[st]["lines"] += 1
        by_state[st]["pieces"] += it["qty"] or 0
        if st in APPLIED:
            b = by_step[str(it["step_no"] or 0)]
            b["lines"] += 1
            b["pieces"] += it["qty"] or 0
            b["cost"] += (it["cost_price"] or 0) * (it["qty"] or 0)
            b["price"] += (it["current_price"] or 0) * (it["qty"] or 0)
        item_rows.append({
            "code": it["display_code"], "colour": m2o_name(it.get("color_value_id")),
            "state": st, "step": it["step_no"], "proposedStep": it["proposed_step_no"],
            "price": it["current_price"], "proposed": it["proposed_price"],
            "full": it["base_price"], "cost": it["cost_price"], "manual": it["manual_price"],
            "idle": it["model_idle_days"], "shown": it["shown_days"],
            "offSeason": it["off_season"], "costIssue": it["cost_issue"] or None,
            "qty": it["qty"], "stageStart": it["stage_start"] or None,
            "nextReview": it["next_review"] or None,
        })

    # ── 3. price match: Meta sheet vs «تصفية» pricelist ───────────────────────
    pls = read_all(odoo, "product.pricelist", [["name", "in", list(TASFIYA_NAMES)]], ["name"])
    mismatches, checked, pl_note, model_summary = [], 0, None, None
    integrated = None
    try:
        rr = read_all(odoo, "deniz.clearance.rule", [], ["tasfiya_integrated"])
        integrated = any(r.get("tasfiya_integrated") for r in rr)
    except Exception as exc:  # field may not exist on older module versions
        log(f"tasfiya_integrated unreadable: {exc}")
    if not pls:
        pl_note = "pricelist «تصفية» not found"
    else:
        pl_id = pls[0]["id"]
        rules = read_all(odoo, "product.pricelist.item", [["pricelist_id", "=", pl_id]],
                         ["applied_on", "product_id", "product_tmpl_id", "categ_id",
                          "compute_price", "fixed_price", "percent_price", "price_discount",
                          "price_surcharge", "price_round", "min_quantity", "date_start",
                          "date_end", "base"])
        order = {"0_product_variant": 0, "1_product": 1, "2_product_category": 2, "3_global": 3}
        rules.sort(key=lambda r: (order.get(r.get("applied_on"), 9), -float(r.get("min_quantity") or 0),
                                  r["id"]))
        log(f"«تصفية» rules: {len(rules)}")

        # The ad price the customer sees = the Meta feed sheet itself (rows Mohanad
        # wrote by hand and rows Odoo appends). Map each in-stock row to its Odoo
        # model by the longest model code its id starts with, then accept the row
        # if ANY in-stock variant of that model gets the ad price on «تصفية».
        sheet = fetch_sheet()
        stock_loc = read_all(odoo, "stock.warehouse", [], ["lot_stock_id"])
        loc_ctx = {"location": m2o_id(stock_loc[0]["lot_stock_id"])} if stock_loc else None
        variants = read_all(odoo, "product.product", [["qty_available", ">", 0]],
                            ["display_name", "lst_price", "product_tmpl_id", "categ_id", "free_qty"],
                            ctx=loc_ctx)
        variants = [v for v in variants if float(v.get("free_qty") or 0) > 0]
        categ_parents = {}
        cids = sorted({m2o_id(v.get("categ_id")) for v in variants if v.get("categ_id")})
        for c in read_all(odoo, "product.category", [["id", "in", cids]], ["parent_path"]):
            categ_parents[c["id"]] = [int(x) for x in (c.get("parent_path") or "").strip("/").split("/") if x]
        by_tmpl = defaultdict(list)
        tmpl_name = {}
        for v in variants:
            tid = m2o_id(v["product_tmpl_id"])
            info = {"id": v["id"], "tmpl": tid, "name": v["display_name"],
                    "categs": categ_parents.get(m2o_id(v.get("categ_id")), []),
                    "lst": float(v.get("lst_price") or 0), "qty": int(float(v.get("free_qty") or 0))}
            info["price"], info["rule"] = pricelist_price(rules, info, now)
            by_tmpl[tid].append(info)
            tmpl_name[tid] = m2o_name(v["product_tmpl_id"]) or ""
        codes = sorted(((norm(n), t) for t, n in tmpl_name.items() if len(norm(n)) >= 4),
                       key=lambda z: -len(z[0]))
        unmatched = []
        model_prices = defaultdict(set)
        for row in sheet:
            if row["availability"] != "in stock":
                continue
            key = norm(row["id"])
            tid = next((t for c, t in codes if key.startswith(c)), None)
            if not tid:
                unmatched.append(row["id"])
                continue
            checked += 1
            vs = by_tmpl[tid]
            ad = row["sale_price"] or row["price"]
            model_prices[tmpl_name[tid]].add(int(ad))
            prices = sorted({int(round(v["price"])) for v in vs})
            if any(abs(v["price"] - ad) <= MISMATCH_IQD for v in vs):
                continue
            mismatches.append({
                "kind": row["label"] or "-", "code": tmpl_name[tid], "feed": row["id"],
                "adPrice": int(ad), "odooPrice": prices[0], "odooPrices": prices[:6],
                "fullPrice": int(round(max(v["lst"] for v in vs))),
                "qty": sum(v["qty"] for v in vs),
            })
        multi = {m: sorted(p) for m, p in model_prices.items() if len(p) > 1}
        model_summary = {"models": len(model_prices), "multiPrice": len(multi),
                         "examples": dict(sorted(multi.items(), key=lambda kv: -(kv[1][-1] - kv[1][0]))[:40])}
        pl_note = (f"sheet rows in stock with no in-stock Odoo model: {len(unmatched)} "
                   f"({', '.join(unmatched[:20])})") if unmatched else None
        mismatches.sort(key=lambda m: -(m["odooPrice"] - m["adPrice"]))

    payload = {
        "syncedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "today": today.isoformat(),
        "window": WINDOW,
        "byState": by_state,
        "byStep": by_step,
        "steps": steps,
        "daily": {d: {str(k): round(q) for k, q in v.items()} for d, v in sorted(daily.items())},
        "priceCheck": {"checked": checked, "mismatchCount": len(mismatches),
                       "tasfiyaIntegrated": integrated, "modelPrices": model_summary,
                       "note": pl_note, "mismatches": mismatches[:400]},
        "items": item_rows,
        "logs": log_rows,
    }

    log(f"steps: { {k: (v['openPieces'], v['sellThrough14']) for k, v in steps.items()} }")
    log(f"price check: {checked} sheet rows, {len(mismatches)} mismatches")
    if printing:
        print(json.dumps({k: payload[k] for k in ("byState", "byStep", "steps", "daily")},
                         ensure_ascii=False, indent=1))
        pc = payload["priceCheck"]
        print(json.dumps({"integrated": pc["tasfiyaIntegrated"], "note": pc["note"],
                          "mismatches": pc["mismatches"][:15]}, ensure_ascii=False, indent=1))
        return 0
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    tmp = OUT_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    os.replace(tmp, OUT_PATH)
    log(f"done in {time.time() - t0:.1f}s → {OUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
