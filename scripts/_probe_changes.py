import os,sys,re,collections as C
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
from datetime import datetime,timedelta
o=Odoo(load_env(ENV_PATH))
def sr(m,dom,f):
    try: return o.kw(m,"search_read",[dom],{"fields":f})
    except Exception as e: print("DENIED",m,str(e)[:200]); return []
loc=lambda s: (datetime.strptime(s,"%Y-%m-%d %H:%M:%S")+timedelta(hours=3))
so=sr("sale.order",[["create_date",">=","2026-11-11 21:00:00"]],["name","state","create_date","date_order","amount_total","order_line"])
print("orders",len(so))
lines=sr("sale.order.line",[["order_id","in",[x["id"] for x in so]]],["order_id","product_id","price_unit","product_uom_qty","discount","route_id"])
L=C.defaultdict(list)
for l in lines: L[l["order_id"][0]].append(l)
T=C.defaultdict(C.Counter)
for x in so:
    d=loc(x["create_date"]).strftime("%m-%d"); ls=L[x["id"]]
    cheap=any(l["price_unit"]<=26000 and l["price_unit"]>0 for l in ls)
    routes={(l["route_id"] or [0,"none"])[1] for l in ls}
    T[d][x["state"]]+=1
    if cheap: T[d]["cheap_"+x["state"]]+=1
    for r in routes: T[d]["route:"+r+":"+x["state"]]+=1
for d in sorted(T): print("DAY",d,dict(sorted(T[d].items())))
ids=[x["id"] for x in so if x["state"] in ("draft","sent","cancel") and x["create_date"]>="2026-11-15 21:00:00"]
ms=sr("mail.message",[["model","=","sale.order"],["res_id","in",ids]],["date","res_id","body","message_type"])
strip=lambda h: re.sub(r"\s+"," ",re.sub(r"<[^>]+>"," ",h or "")).strip()
pat=C.Counter((loc(m["date"]).strftime("%m-%d"),re.sub(r"[\d,]+","#",strip(m["body"]))[:110]) for m in ms if strip(m["body"]))
for (d,p),n in sorted(pat.items()):
    if n>=2: print("MSG",d,n,"|",p)
names={x["id"]:(x["name"],x["state"],loc(x["create_date"]).strftime("%m-%d %H:%M")) for x in so}
for x in so:
    if x["state"] in ("draft","sent") and x["create_date"]>="2026-11-15 21:00:00":
        ls=L[x["id"]]; print("OPEN",*names[x["id"]],"|",[( (l["product_id"] or [0,""])[1][:30],l["price_unit"],(l["route_id"] or [0,""])[1]) for l in ls][:4])
