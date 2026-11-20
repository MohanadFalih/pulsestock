import os,sys,collections as C
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
o=Odoo(load_env(ENV_PATH))
for m in o.kw("ir.module.module","search_read",[[["name","in",["deniz_catalog","deniz_clearance","deniz_liquidation"]]]],{"fields":["name","latest_version"]}): print("MOD",m["name"],m["latest_version"])
fl=o.kw("product.template","search_read",[[["deniz_oneprice_on","=",True]]],{"fields":["name"]})
print("STAGNANT_FLAGGED",len(fl),[x["name"] for x in fl[:8]])
for model in ("deniz.liquidation.item","deniz.clearance.item","product.template"):
    ms=o.kw("mail.message","search_read",[[["model","=",model],["date",">=","2026-11-20 13:50:00"],["body","ilike","سعر واحد"]]],{"fields":["record_name","body"]})
    print("MSG",model,len(ms),C.Counter(("حي" if "حي" in m["body"] else "راكد" if "راكد" in m["body"] else "رجع") for m in ms))
for it in o.kw("deniz.liquidation.item","search_read",[[["code","=","H-1945"],["state","=","live"]]],{"fields":["feed_id","sale_price","old_price","published_price"]}): print("AD",it)
codes=["H-1945"]+[x["name"] for x in fl[:1]]
for code in codes:
    r=o.kw("deniz.anasgram","ask",[code]); rep=r.get("reply") or {}
    print("=== CAPTION",code); print("\n".join((rep.get("caption") or "").split("\n")[:6]))
    print("=== INFO",code); print("\n".join((rep.get("info") or [])[:5]))
