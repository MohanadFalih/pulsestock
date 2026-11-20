import os,sys,collections as C
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
o=Odoo(load_env(ENV_PATH))
items=o.kw("deniz.liquidation.item","search_read",[[["published_date","!=",False]]],{"fields":["code","state","variant_ids","published_date","sold_date","sale_price","old_price","real_price","published_price","product_tmpl_id","ad_price_only"],"context":{"active_test":False}})
print("ITEMS",len(items))
vmap=C.defaultdict(list)
for it in items:
    for v in it["variant_ids"]: vmap[v].append(it)
lines=o.kw("sale.order.line","search_read",[[["product_id","in",list(vmap)],["order_id.state","in",["sale","done"]],["create_date",">=","2026-09-01 00:00:00"]]],{"fields":["product_id","price_unit","product_uom_qty","create_date","route_id","order_id","discount"]})
print("LINES",len(lines))
lp=o.kw("product.product","read",[list({l["product_id"][0] for l in lines})],{"fields":["lst_price","product_tmpl_id"]})
full={p["id"]:p["lst_price"] for p in lp}
for l in lines:
    if l["route_id"]: continue   # طلب تركيا
    its=[i for i in vmap[l["product_id"][0]] if i["published_date"]<=l["create_date"] and (not i["sold_date"] or i["sold_date"]>=l["create_date"][:10])]
    if not its: continue
    it=sorted(its,key=lambda i:i["published_date"])[-1]
    ref=max(it["real_price"] or 0, it["old_price"] or 0, int(full.get(l["product_id"][0]) or 0))
    print("L",l["create_date"][:10],it["code"],int(l["price_unit"]),ref,it["sale_price"],it["real_price"],it["old_price"],int(l["product_uom_qty"]),int(l["discount"] or 0))
