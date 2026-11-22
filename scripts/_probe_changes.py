import os,sys,collections as C
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
o=Odoo(load_env(ENV_PATH))
def sr(m,dom,f,**kw):
    try: return o.kw(m,"search_read",[dom],dict({"fields":f},**kw))
    except Exception as e: print("ERR",m,str(e)[:300]); return []
P=sr("product.product",[["default_code","ilike","M-158ART1138"]],["display_name","default_code","lst_price","qty_available","free_qty","deniz_shelf_qty","product_tmpl_id"])
for p in P: print("P",p["id"],p["display_name"][:60],p["lst_price"],"onhand",p["qty_available"],"free",p["free_qty"],"shelf",p["deniz_shelf_qty"])
tgt=[p for p in P if "46" in p["display_name"] and ("Lacivert" in p["display_name"] or "نيلي" in p["display_name"])]
print("TARGET",[(p["id"],p["display_name"]) for p in tgt])
for p in tgt:
    for q in sr("stock.quant",[["product_id","=",p["id"]],["location_id.usage","=","internal"]],["location_id","quantity","reserved_quantity"]): print("  Q",q["location_id"][1],q["quantity"],q["reserved_quantity"])
    for l in sr("sale.order.line",[["product_id","=",p["id"]],["create_date",">=","2026-11-01 00:00:00"]],["order_id","state","product_uom_qty","qty_delivered","price_unit","route_id","create_date"]):
        print("  L",l["order_id"][1],l["state"],l["product_uom_qty"],l["qty_delivered"],l["price_unit"],(l["route_id"] or [0,""])[1],l["create_date"])
    for ml in sr("stock.move.line",[["product_id","=",p["id"]],["state","not in",["cancel","done"]]],["location_id","location_dest_id","quantity","reference","state"]): print("  ML",ml["reference"],ml["location_id"][1],"->",ml["location_dest_id"][1],ml["quantity"],ml["state"])
    for r in sr("product.pricelist.item",[["product_id","=",p["id"]],["deniz_resale_source","!=",False]],["pricelist_id","fixed_price","date_start","date_end","deniz_resale_source"],context={"active_test":False}): print("  R",r)
for so in sr("sale.order",[["name","=","S35227"]],["state","create_date","date_order","user_id","order_line"]):
    print("SO",so)
    for l in sr("sale.order.line",[["order_id","=",so["id"]]],["product_id","product_uom_qty","price_unit","route_id","discount"]): print("  SL",l["product_id"][1][:50],l["product_uom_qty"],l["price_unit"],(l["route_id"] or [0,""])[1],l["discount"])
