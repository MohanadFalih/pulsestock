#!/usr/bin/env python3
"""Identify untracked selling templates + count the full active set. Aggregates only."""
import json, os, urllib.request
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

# Names + creation dates of the top untracked sellers
ids = [4649, 5488, 7125, 7111, 5690]
for t in odoo.kw("product.template", "read", [ids, ["name", "create_date", "list_price", "sale_ok", "categ_id"]]):
    print(f"tmpl {t['id']:5d}  created {t['create_date'][:10]}  sale_ok={t['sale_ok']}  "
          f"price={t['list_price']:>8.0f}  categ={t['categ_id'][1] if t.get('categ_id') else '-':20s}  name={t['name'][:60]!r}")

# How big is the full active-lifecycle set without the 120 cap?
import datetime
days_ago = lambda n: (datetime.date.today() - datetime.timedelta(days=n)).isoformat()
recent = odoo.kw("product.template", "search",
    [[["sale_ok", "=", True], ["create_date", ">=", days_ago(120)]]])
rows = odoo.kw("sale.order.line", "read_group",
    [[("order_id.state", "in", ["sale", "done"]), ("create_date", ">=", days_ago(60))],
     ["product_uom_qty:sum"], ["product_id"]])
pids = [r["product_id"][0] for r in rows if r.get("product_id")]
tmpls = set()
for i in range(0, len(pids), 200):
    for v in odoo.kw("product.product", "read", [pids[i:i+200], ["product_tmpl_id"]]):
        tmpls.add(v["product_tmpl_id"][0])
union = set(recent) | tmpls
print(f"\ncreated<=120d: {len(recent)} | ordered<=60d: {len(tmpls)} | union (no cap): {len(union)}")
older_selling = sorted(tmpls - set(recent))
print(f"selling but created >120d ago: {len(older_selling)} -> {older_selling[:10]}")
