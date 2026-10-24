#!/usr/bin/env python3
"""PulseStock — sales team diagnostics (READ-ONLY).

Per salesperson (sale.order.user_id) over the last 6 months: orders, Turkey
orders, units, revenue, active days, orders per active day, cancellations,
and return rate on mature orders (>= 14 days old).

PRIVACY: the repository is public, so this prints Odoo user IDs only
("U17"), never names, phone numbers or salaries. The owner maps IDs to
people inside Odoo.
"""

import collections
import datetime as dt
import json
import os
import sys
import time
import urllib.request

RPC_TIMEOUT = 180
MONTHS = 6
MATURE_DAYS = 14
TURKEY_ROUTE_NAME = "Order from Turkey"  # same as odoo_sync.py


def log(m):
    print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)


class Odoo:
    def __init__(self):
        self.url = os.environ["ODOO_URL"].rstrip("/")
        self.db = os.environ["ODOO_DB"]
        self.key = os.environ["ODOO_API_KEY"]
        self._id = 0
        self.uid = self._rpc("common", "authenticate",
                             [self.db, os.environ["ODOO_USER"], self.key, {}])

    def _rpc(self, service, method, args):
        self._id += 1
        payload = {"jsonrpc": "2.0", "method": "call", "id": self._id,
                   "params": {"service": service, "method": method, "args": args}}
        req = urllib.request.Request(self.url + "/jsonrpc", data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=RPC_TIMEOUT) as r:
            res = json.load(r)
        if "error" in res:
            raise RuntimeError(res["error"].get("data", {}).get("message", res["error"]))
        return res["result"]

    def kw(self, model, method, args, kwargs=None):
        return self._rpc("object", "execute_kw",
                         [self.db, self.uid, self.key, model, method, args, kwargs or {}])


def uid_label(v):
    return f"U{v[0]}" if isinstance(v, (list, tuple)) and v else "none"


def main():
    odoo = Odoo()
    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=3)))
    today = now.date()
    since = (today - dt.timedelta(days=30 * MONTHS)).isoformat()
    mature_before = (today - dt.timedelta(days=MATURE_DAYS)).isoformat()

    line_have = odoo.kw("sale.order.line", "fields_get", [], {"attributes": ["type"]})
    line_fields = [f for f in ["order_id", "product_id", "product_uom_qty", "qty_delivered",
                               "price_total", "route_id", "display_type", "is_delivery"]
                   if f in line_have]

    # Carrier products (delivery fee lines) — excluded from goods.
    carrier_pids = set()
    try:
        for c in odoo.kw("delivery.carrier", "search_read", [[]], {"fields": ["product_id"]}):
            if c.get("product_id"):
                carrier_pids.add(c["product_id"][0])
    except Exception as e:
        log(f"carrier lookup failed: {e}")

    def route_ok(name):
        return name == TURKEY_ROUTE_NAME

    orders = odoo.kw("sale.order", "search_read",
                     [[["create_date", ">=", since]]],
                     {"fields": ["create_date", "state", "user_id"], "limit": 50000})
    log(f"{len(orders)} orders since {since}")
    by_id = {o["id"]: o for o in orders}

    ret_by_line = {}
    for r in odoo.kw("stock.move", "read_group",
                     [[["origin_returned_move_id", "!=", False], ["state", "=", "done"],
                       ["sale_line_id", "!=", False]], ["product_uom_qty:sum"], ["sale_line_id"]],
                     {"lazy": False}):
        if r.get("sale_line_id"):
            ret_by_line[r["sale_line_id"][0]] = r.get("product_uom_qty") or 0.0

    conf_ids = [o["id"] for o in orders if o["state"] in ("sale", "done")]
    lines = []
    for i in range(0, len(conf_ids), 400):
        lines.extend(odoo.kw("sale.order.line", "search_read",
                             [[["order_id", "in", conf_ids[i:i + 400]]]],
                             {"fields": line_fields, "limit": 50000}))
    log(f"{len(lines)} lines")

    S = collections.defaultdict(lambda: collections.Counter())
    days = collections.defaultdict(set)
    month_orders = collections.defaultdict(collections.Counter)      # month -> user -> orders
    month_days = collections.defaultdict(lambda: collections.defaultdict(set))
    turkey_orders = collections.defaultdict(set)

    for o in orders:
        u = uid_label(o.get("user_id"))
        d = (o["create_date"] or "")[:10]
        if o["state"] == "cancel":
            S[u]["cancelled"] += 1
            continue
        if o["state"] not in ("sale", "done"):
            continue
        S[u]["orders"] += 1
        days[u].add(d)
        month_orders[d[:7]][u] += 1
        month_days[d[:7]][u].add(d)

    for ln in lines:
        if ln.get("display_type") or ln.get("is_delivery"):
            continue
        pid = ln["product_id"][0] if ln.get("product_id") else None
        if pid in carrier_pids:
            continue
        qty = ln.get("product_uom_qty") or 0.0
        total = ln.get("price_total") or 0.0
        if qty <= 0 or total <= 0:
            continue
        o = by_id.get(ln["order_id"][0])
        if not o:
            continue
        u = uid_label(o.get("user_id"))
        price = total / qty
        turkey = bool(ln.get("route_id")) and route_ok(ln["route_id"][1])
        if turkey:
            turkey_orders[u].add(o["id"])
        S[u]["units"] += qty
        S[u]["revenue"] += total
        if (o["create_date"] or "")[:10] < mature_before:
            ret = ret_by_line.get(ln["id"], 0.0)
            dlv = ln.get("qty_delivered") or 0.0
            S[u]["m_ordered_val"] += qty * price
            S[u]["m_kept_val"] += max(0.0, dlv) * price
            S[u]["m_shipped_val"] += (max(0.0, dlv) + ret) * price
            S[u]["m_ret_val"] += ret * price
            if turkey:
                S[u]["mt_shipped_val"] += (max(0.0, dlv) + ret) * price
                S[u]["mt_ret_val"] += ret * price

    people = []
    for u, c in S.items():
        if not c["orders"]:
            continue
        ad = len(days[u])
        people.append({
            "user": u,
            "orders": c["orders"],
            "turkeyOrders": len(turkey_orders[u]),
            "cancelled": c["cancelled"],
            "units": round(c["units"]),
            "revenueM": round(c["revenue"] / 1e6, 1),
            "activeDays": ad,
            "firstDay": min(days[u]), "lastDay": max(days[u]),
            "ordersPerActiveDay": round(c["orders"] / ad, 1) if ad else 0,
            "avgOrderK": round(c["revenue"] / c["orders"] / 1000, 1),
            "returnRatePct": round(100 * c["m_ret_val"] / c["m_shipped_val"], 1) if c["m_shipped_val"] else None,
            "turkeyReturnRatePct": round(100 * c["mt_ret_val"] / c["mt_shipped_val"], 1) if c["mt_shipped_val"] else None,
            "keepRatePct": round(100 * c["m_kept_val"] / c["m_ordered_val"], 1) if c["m_ordered_val"] else None,
            "returnedValueM": round(c["m_ret_val"] / 1e6, 1),
        })
    people.sort(key=lambda p: -p["orders"])

    months = []
    for m in sorted(month_orders):
        cnt = month_orders[m]
        ndays = len({d for s in month_days[m].values() for d in s})
        active = [u for u, n in cnt.items() if n >= 20]
        months.append({
            "month": m, "orders": sum(cnt.values()), "days": ndays,
            "ordersPerDay": round(sum(cnt.values()) / ndays, 1) if ndays else 0,
            "salespeopleWith20plus": len(active),
            "byUser": dict(cnt.most_common()),
        })

    report = {"since": since, "matureBefore": mature_before, "people": people, "months": months}
    print("\n=====DIAG_JSON_BEGIN=====")
    print(json.dumps(report, ensure_ascii=False, indent=1))
    print("=====DIAG_JSON_END=====")


if __name__ == "__main__":
    sys.exit(main())
