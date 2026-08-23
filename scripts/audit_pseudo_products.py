#!/usr/bin/env python3
"""Check how to robustly identify delivery/discount pseudo-products."""
import json, os, urllib.request

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

# 1. Product types of the three known pseudo-products
for t in odoo.kw("product.template", "read",
                 [[4649, 5488, 5690], ["name", "type", "sale_ok", "list_price"]]):
    print(f"tmpl {t['id']}: type={t.get('type')} sale_ok={t['sale_ok']} price={t['list_price']} name={t['name']!r}")

# 2. Delivery carrier products
try:
    carriers = odoo.kw("delivery.carrier", "search_read", [[]], {"fields": ["name", "product_id"]})
    print("\ndelivery.carrier products:")
    for c in carriers:
        print(f"  carrier {c['name']!r} -> product_id {c['product_id']}")
except Exception as e:
    print("delivery.carrier not available:", e)

# 3. Loyalty discount products
try:
    rewards = odoo.kw("loyalty.reward", "search_read", [[]], {"fields": ["description", "discount_line_product_id"]})
    print("\nloyalty discount products:")
    for r in rewards:
        print(f"  {r.get('description')!r} -> {r.get('discount_line_product_id')}")
except Exception as e:
    print("loyalty.reward not available:", e)

# 4. Sanity: among 323 active templates, how many do NOT match the SKU-name pattern?
import re, datetime
SKU = re.compile(r"^[A-Za-z]{1,3}[-\s]?\d{3,4}$")
days_ago = lambda n: (datetime.date.today() - datetime.timedelta(days=n)).isoformat()
recent = odoo.kw("product.template", "search",
    [[["sale_ok", "=", True], ["create_date", ">=", days_ago(120)]]])
rows = odoo.kw("sale.order.line", "read_group",
    [[("order_id.state", "in", ["sale", "done"]), ("create_date", ">=", days_ago(60))],
     ["product_uom_qty:sum"], ["product_id"]])
pids = [r["product_id"][0] for r in rows if r.get("product_id")]
tmpls_ordered = set()
for i in range(0, len(pids), 200):
    for v in odoo.kw("product.product", "read", [pids[i:i+200], ["product_tmpl_id"]]):
        tmpls_ordered.add(v["product_tmpl_id"][0])
union = sorted(set(recent) | tmpls_ordered)
names = odoo.kw("product.template", "read", [union, ["name", "type", "sale_ok", "list_price"]])
non_sku = [t for t in names if not SKU.match((t["name"] or "").strip())]
print(f"\nunion={len(union)}; non-SKU-named: {len(non_sku)}")
for t in non_sku[:25]:
    print(f"  tmpl {t['id']:5d} type={t.get('type'):8s} sale_ok={t['sale_ok']} price={t['list_price']:>8.0f} name={t['name'][:50]!r}")
