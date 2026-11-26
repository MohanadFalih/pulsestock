import os,sys,collections as C
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
o=Odoo(load_env(ENV_PATH))
def sr(m,dom,f,**kw):
    try: return o.kw(m,"search_read",[dom],dict({"fields":f},**kw))
    except Exception as e: print("ERR",m,str(e)[:200]); return []
print("FLAG",o.kw("product.template","search_count",[[["deniz_oneprice_on","=",True]]]),"was_on",o.kw("product.template","search_count",[[["deniz_oneprice_on","=",True],["deniz_oneprice_purchase_was","=",True]]]))
for name in ("S35347","S35189","S35141"):
    for so in sr("sale.order",[["name","=",name]],["state","date_order","user_id","picking_ids"]):
        print("SO",name,so["state"],so["date_order"],so["user_id"] and so["user_id"][1])
        for l in sr("sale.order.line",[["order_id","=",so["id"]]],["product_id","price_unit","product_uom_qty","qty_delivered","route_id"]):
            p=sr("product.product",[["id","=",l["product_id"][0]]],["deniz_shelf_qty","purchase_ok","product_tmpl_id"])[0]
            t=sr("product.template",[["id","=",p["product_tmpl_id"][0]]],["deniz_oneprice_on","deniz_oneprice_purchase_was","purchase_ok"])[0]
            print("  L",l["product_id"][1][:45],l["price_unit"],l["product_uom_qty"],"del",l["qty_delivered"],"route",l["route_id"] and l["route_id"][1],"shelf",p["deniz_shelf_qty"],"tmpl",t)
# lines since 20/11 on models with oneprice flag (now or released): how many from shelf vs not
tm=sr("product.template",["|",["deniz_oneprice_on","=",True],["deniz_oneprice_purchase_was","=",True]],["id"],context={"active_test":False})
ids=[t["id"] for t in tm]
L=sr("sale.order.line",[["product_id.product_tmpl_id","in",ids],["order_id.state","in",["sale","done"]],["create_date",">=","2026-11-20 13:00:00"]],["order_id","product_id","price_unit","route_id","qty_delivered","move_ids"])
print("LINES since 20/11 on one-price models:",len(L),"with route",sum(1 for l in L if l["route_id"]))
mv=sr("stock.move",[["id","in",[m for l in L for m in l["move_ids"]]]],["id","state","location_id","picking_type_id"])
mvs={m["id"]:m for m in mv}
cnt=C.Counter()
for l in L:
    ms=[mvs[m] for m in l["move_ids"] if m in mvs]
    st=",".join(sorted({m["state"] for m in ms})) or "nomove"
    cnt[st]+=1
    if not any(m["state"] in ("assigned","done") for m in ms) and not l["route_id"]:
        print("  STUCK?",l["order_id"][1],l["product_id"][1][:40],l["price_unit"],st)
print("MOVESTATES",cnt)
