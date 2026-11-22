import os,sys,collections as C
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
o=Odoo(load_env(ENV_PATH))
def sr(m,dom,f,**kw):
    try: return o.kw(m,"search_read",[dom],dict({"fields":f},**kw))
    except Exception as e: print("ERR",m,str(e)[:300]); return []
sl=sr("sale.order.line",[["id","=",86796]],["product_id"])
pid=[x["product_id"][0] for x in sl]
P=sr("product.product",[["id","in",pid]],["display_name","default_code","lst_price","qty_available","free_qty","deniz_shelf_qty","product_tmpl_id"])
for p in P: print("P",p["id"],p["display_name"][:60],p["lst_price"],"onhand",p["qty_available"],"free",p["free_qty"],"shelf",p["deniz_shelf_qty"])
tgt=P
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

for p in tgt:
    ms=sr("mail.message",[["model","=","sale.order"],["res_id","=",39117]],["date","body","author_id"])
    import re
    for m in ms: print("  MSG",m["date"],re.sub(r"<[^>]+>"," ",m["body"] or "")[:200])
    t=p["product_tmpl_id"][0]
    print("TMPL",sr("product.template",[["id","=",t]],["name","purchase_ok","deniz_oneprice_on","list_price"]))
    for c in sr("deniz.clearance.item",[["product_tmpl_id","=",t]],["display_code","state","step_no","current_price","base_price","qty","write_date","close_reason"]): print("  CLR",c)
    for it in sr("deniz.liquidation.item",[["product_tmpl_id","=",t]],["feed_id","state","sale_price","old_price","write_date"],context={"active_test":False}): print("  LIQ",it)
print("=== MOVES")
for m in sr("stock.move",[["product_id","=",680907],["create_date",">=","2026-11-15 00:00:00"]],["reference","origin","state","product_uom_qty","location_id","location_dest_id","create_date","write_date","sale_line_id","picking_type_id"]):
    print("  MV",m["create_date"],m["write_date"],m["reference"],m["origin"],m["state"],m["product_uom_qty"],m["location_id"][1],"->",m["location_dest_id"][1],m["sale_line_id"] and m["sale_line_id"][1][:30])
print("=== DELETED/ALL LINES")
for l in sr("sale.order.line",[["product_id","=",680907]],["order_id","state","create_date","write_date","price_unit","product_uom_qty"],context={"active_test":False}): print("  AL",l)
print("=== TRACK")
for m in sr("mail.message",[["model","=","sale.order"],["res_id","=",39117]],["date","author_id","tracking_value_ids","subtype_id","message_type"]):
    tv=sr("mail.tracking.value",[["id","in",m["tracking_value_ids"]]],["field_id","old_value_char","new_value_char","old_value_float","new_value_float"]) if m["tracking_value_ids"] else []
    print("  T",m["date"],m["author_id"] and m["author_id"][1],m["message_type"],[(t["field_id"][1] if t["field_id"] else "",t["old_value_char"] or t["old_value_float"],t["new_value_char"] or t["new_value_float"]) for t in tv])
for m in sr("mail.message",[["model","=","sale.order.line"],["res_id","=",86796]],["date","author_id","body"]): print("  TL",m)
