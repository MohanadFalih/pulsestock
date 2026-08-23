#!/usr/bin/env python3
"""One-off diagnostic: why PulseStock 7-day orders != Odoo quotation counts.
Prints ONLY aggregate counts — never credentials."""
import json, os, sys, urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
env = {}
for line in open(os.path.join(HERE, "..", ".env")):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")

class Odoo:
    def __init__(self):
        self.url = env["ODOO_URL"].rstrip("/"); self.db = env["ODOO_DB"]
        self.key = env["ODOO_API_KEY"]; self._id = 0
        self.uid = self._rpc("common", "authenticate", [self.db, env["ODOO_USER"], self.key, {}])
    def _rpc(self, service, method, args):
        self._id += 1
        payload = {"jsonrpc": "2.0", "method": "call", "id": self._id,
                   "params": {"service": service, "method": method, "args": args}}
        req = urllib.request.Request(self.url + "/jsonrpc", data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            res = json.load(r)
        if "error" in res: raise RuntimeError(res["error"])
        return res["result"]
    def kw(self, model, method, args, kwargs=None):
        return self._rpc("object", "execute_kw",
                         [self.db, self.uid, self.key, model, method, args, kwargs or {}])

odoo = Odoo()

# 1. ALL order documents created Aug 11-20 UTC, by day + state
orders = odoo.kw("sale.order", "search_read",
    [[["create_date", ">=", "2026-08-11 00:00:00"],
      ["create_date", "<", "2026-08-21 00:00:00"]]],
    {"fields": ["name", "state", "create_date"], "limit": 5000})
by_day_state = defaultdict(lambda: defaultdict(int))
for o in orders:
    by_day_state[o["create_date"][:10]][o["state"]] += 1
print("== sale.order DOCUMENTS by day and state (UTC) ==")
for day in sorted(by_day_state):
    st = by_day_state[day]
    print(f"{day}  total={sum(st.values()):3d}  " + "  ".join(f"{k}={v}" for k, v in sorted(st.items())))

# 2. UNITS on confirmed lines, Aug 13-19, ALL products vs tracked-120
live = json.load(open(os.path.join(HERE, "..", "public", "data", "live.json")))
tracked = {p["odooId"] for p in live["products"]}

lines = odoo.kw("sale.order.line", "search_read",
    [[["order_id.state", "in", ["sale", "done"]],
      ["create_date", ">=", "2026-08-11 00:00:00"],
      ["create_date", "<", "2026-08-21 00:00:00"]]],
    {"fields": ["product_id", "create_date", "product_uom_qty"], "limit": 20000})

# variant -> template map (only need membership in tracked set)
var_ids = sorted({ln["product_id"][0] for ln in lines if ln.get("product_id")})
tmap = {}
for i in range(0, len(var_ids), 200):
    for v in odoo.kw("product.product", "read", [var_ids[i:i+200], ["product_tmpl_id"]]):
        tmap[v["id"]] = v["product_tmpl_id"][0]

units_all = defaultdict(float)
units_tracked = defaultdict(float)
untracked_tmpls = defaultdict(float)
for ln in lines:
    day = ln["create_date"][:10]
    qty = ln.get("product_uom_qty") or 0.0
    units_all[day] += qty
    tid = tmap.get(ln["product_id"][0])
    if tid in tracked:
        units_tracked[day] += qty
    else:
        untracked_tmpls[tid] += qty

print("\n== UNITS on confirmed lines: all products vs tracked-120 ==")
for day in sorted(units_all):
    print(f"{day}  all={units_all[day]:4.0f}  tracked={units_tracked[day]:4.0f}  "
          f"missed={units_all[day]-units_tracked[day]:3.0f}")

w = lambda dd: sum(units_all.get(f"2026-08-{n:02d}", 0) for n in dd)
wt = lambda dd: sum(units_tracked.get(f"2026-08-{n:02d}", 0) for n in dd)
r13_19 = range(13, 20); r14_20 = range(14, 21)
print(f"\nAug13-19 units: all={w(r13_19):.0f} tracked={wt(r13_19):.0f}")
print(f"Aug14-20 units: all={w(r14_20):.0f} tracked={wt(r14_20):.0f}")
print("\nUntracked templates with units (top):",
      sorted(untracked_tmpls.items(), key=lambda x: -x[1])[:5])
