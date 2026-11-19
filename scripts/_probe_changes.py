import os,sys,re,json,collections as C
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
o=Odoo(load_env(ENV_PATH))
def sr(m,dom,f,ctx=None,lim=0):
    kw={"fields":f}
    if ctx: kw["context"]=ctx
    if lim: kw["limit"]=lim
    return o.kw(m,"search_read",[dom],kw)
strip=lambda h: re.sub(r"<[^>]+>"," ",h or "").strip()[:220]
out={}
# A. conversion decision
out["convert"]=sr("deniz.resale.decision",[["kind","=","convert"]],["name","state","decided_at","decided_by","result","create_date"],{"active_test":False})
# B. list_price / catalog_price / sale_price tracking since 16th
fields_=sr("ir.model.fields",[["name","in",["list_price","catalog_price","sale_price"]],["model","in",["product.template","deniz.liquidation.item"]]],["name","model"])
fid={f["id"]:(f["model"],f["name"]) for f in fields_}
tv=sr("mail.tracking.value",[["field_id","in",list(fid)],["create_date",">=","2026-11-15 21:00:00"]],["field_id","old_value_float","new_value_float","old_value_monetary","new_value_monetary","mail_message_id","create_date"])
msgids=list({t["mail_message_id"][0] for t in tv})
msgs={m["id"]:m for m in sr("mail.message",[["id","in",msgids]],["model","res_id","date","author_id","record_name"])} if msgids else {}
rows=[]
for t in tv:
    m=msgs.get(t["mail_message_id"][0],{})
    old=t.get("old_value_float") or t.get("old_value_monetary") or 0; new=t.get("new_value_float") or t.get("new_value_monetary") or 0
    rows.append({"f":fid[t["field_id"][0]],"rec":m.get("record_name"),"date":m.get("date"),"by":(m.get("author_id") or [0,""])[1],"old":old,"new":new})
out["tracking_count"]=len(rows)
agg=C.Counter(); 
for r in rows: agg[(r["f"][1], r["date"][:13] if r["date"] else "?", "up" if r["new"]>r["old"] else "down", r["by"])]+=1
out["tracking_by_hour"]=sorted([list(k)+[v] for k,v in agg.items()])
out["tracking_rows"]=rows
# C. shared models
codes=["L-1800","H-1951","H-1938"]
tm=sr("product.template",[["name","in",codes]],["name","list_price","liq_base_price","liq_discount_on","catalog_price","standard_price"],{"active_test":False})
out["shared"]=[]
for t in tm:
    ci=sr("deniz.clearance.item",[["product_tmpl_id","=",t["id"]]],["display_code","state","step_no","current_price","applied_at","qty","create_date"])
    li=sr("deniz.liquidation.item",[["product_tmpl_id","=",t["id"]]],["feed_id","state","sale_price","old_price","write_date","ladder_step"])
    ms=sr("mail.message",[["model","=","product.template"],["res_id","=",t["id"]],["date",">=","2026-11-15 21:00:00"]],["date","author_id","body"])
    pli=sr("product.pricelist.item",[["product_tmpl_id","=",t["id"]],["pricelist_id.name","=","تصفية"]],["applied_on","product_id","fixed_price","date_start","date_end","deniz_resale_source"],{"active_test":False})
    vq=sr("product.product",[["product_tmpl_id","=",t["id"]],["qty_available",">",0]],["display_name","qty_available","lst_price"])
    out["shared"].append({"t":t,"clr":ci,"liq":li,"msgs":[(m["date"],(m["author_id"] or [0,""])[1],strip(m["body"])) for m in ms],"tasfiya":pli,"stock":vq})
# D. clearance items applied since 18th by hour
ci=sr("deniz.clearance.item",[["applied_at",">=","2026-11-15 21:00:00"]],["applied_at","state","current_price","step_no"])
out["clr_applied_by_hour"]=sorted(C.Counter(x["applied_at"][:13] for x in ci).items())
json.dump(out,open("/tmp/probe_out.json","w"),ensure_ascii=False,default=str)
print("=== convert", json.dumps(out["convert"],ensure_ascii=False,default=str)[:1500])
print("=== tracking_count", out["tracking_count"])
for r in out["tracking_by_hour"]: print("TB",r)
print("=== clr applied by hour", out["clr_applied_by_hour"])
for s in out["shared"]:
    print("=== SHARED", json.dumps(s["t"],ensure_ascii=False))
    print(" clr", json.dumps(s["clr"],ensure_ascii=False,default=str)[:600])
    print(" liq", json.dumps(s["liq"],ensure_ascii=False,default=str)[:600])
    print(" tasfiya", json.dumps(s["tasfiya"],ensure_ascii=False,default=str)[:600])
    print(" stock", json.dumps(s["stock"],ensure_ascii=False,default=str)[:400])
    for m in s["msgs"]: print(" MSG",m)
# list_price changes on templates: per model old->new (largest)
lp=[r for r in out["tracking_rows"] if r["f"]==("product.template","list_price")]
print("=== list_price changes",len(lp),"up",sum(1 for r in lp if r["new"]>r["old"]),"down",sum(1 for r in lp if r["new"]<r["old"]))
for r in sorted(lp,key=lambda r:-(r["new"]-r["old"]))[:40]: print("LP",r["date"],r["rec"],r["old"],"->",r["new"],r["by"])
cp=[r for r in out["tracking_rows"] if r["f"]==("product.template","catalog_price")]
print("=== catalog_price changes",len(cp),"up",sum(1 for r in cp if r["new"]>r["old"]))
sp=[r for r in out["tracking_rows"] if r["f"]==("deniz.liquidation.item","sale_price")]
print("=== liq sale_price changes",len(sp),"up",sum(1 for r in sp if r["new"]>r["old"]),"down",sum(1 for r in sp if r["new"]<r["old"]))
