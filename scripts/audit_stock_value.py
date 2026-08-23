#!/usr/bin/env python3
"""Diagnose warehouse-stock discrepancy vs Odoo Inventory Stock report.

Target (user screenshot, 2026-08-22, filter "Available Products"):
  On Hand 2,197 | Total Value 67,267,742 IQD | 1,735 records
Current sync says: 4,151 units / ~203.7M IQD (list_price valuation).
"""
import json, sys, collections
sys.path.insert(0, "/mnt/agents/output/app/scripts")
from odoo_sync import Odoo, load_env, ENV_PATH

env = load_env(ENV_PATH)
odoo = Odoo(env)

# 1. Per-location breakdown of internal quants
rows = odoo.read_group(
    "stock.quant",
    [("location_id.usage", "=", "internal")],
    ["quantity:sum", "reserved_quantity:sum"], ["location_id"])
print("=== internal quants by location ===")
tot = 0.0
for r in rows:
    loc = r["location_id"][1] if r.get("location_id") else "?"
    q = r.get("quantity") or 0.0
    tot += q
    print(f"  {loc:<40} qty {q:>10,.2f}  reserved {r.get('reserved_quantity') or 0:>8,.2f}  ({r['location_id_count']} quants)")
print(f"  NET total: {tot:,.2f}")

# 2. Negative vs positive
neg = odoo.read_group(
    "stock.quant",
    [("location_id.usage", "=", "internal"), ("quantity", "<", 0)],
    ["quantity:sum"], ["product_id"])
neg_sum = sum(r.get("quantity") or 0 for r in neg)
print(f"\nnegative-quant products: {len(neg)}, net negative qty: {neg_sum:,.2f}")

# 3. Company check
comps = odoo.kw("res.company", "search_read", [[]], {"fields": ["name"]})
print("\ncompanies:", [(c["id"], c["name"]) for c in comps])
loc_comp = collections.Counter()
for r in odoo.read_group("stock.quant", [("location_id.usage","=","internal")],
                         ["quantity:sum"], ["company_id"]):
    loc_comp[r["company_id"][1] if r.get("company_id") else "?"] += r.get("quantity") or 0
print("qty by company:", dict(loc_comp))

# 4. Valuation: standard_price (cost) vs list_price, on POSITIVE-on-hand products
prow = odoo.read_group(
    "stock.quant",
    [("location_id.usage", "=", "internal")],
    ["quantity:sum"], ["product_id"])
var_qty = {r["product_id"][0]: (r.get("quantity") or 0.0) for r in prow if r.get("product_id")}
ids = list(var_qty)
cost_of = {}; price_of = {}
for i in range(0, len(ids), 200):
    for v in odoo.kw("product.product", "read", [ids[i:i+200], ["standard_price", "list_price"]]):
        cost_of[v["id"]] = v.get("standard_price") or 0.0
        price_of[v["id"]] = v.get("list_price") or 0.0

gross_units = sum(q for q in var_qty.values() if q > 0)
net_units = sum(var_qty.values())
val_cost_pos = sum(q * cost_of.get(v,0) for v,q in var_qty.items() if q > 0)
val_cost_net = sum(q * cost_of.get(v,0) for v,q in var_qty.items())
val_list_pos = sum(q * price_of.get(v,0) for v,q in var_qty.items() if q > 0)
n_pos = sum(1 for q in var_qty.values() if q > 0)
print(f"\nvariants with on-hand > 0: {n_pos}   (Odoo report shows 1,735 records)")
print(f"gross positive units : {gross_units:,.0f}")
print(f"net units            : {net_units:,.0f}   (Odoo On Hand: 2,197)")
print(f"value @cost  (pos)   : {val_cost_pos:,.0f} IQD")
print(f"value @cost  (net)   : {val_cost_net:,.0f} IQD   (Odoo Total Value: 67,267,742)")
print(f"value @list  (pos)   : {val_list_pos:,.0f} IQD")
