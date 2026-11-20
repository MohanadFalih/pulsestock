import os,sys,collections as C
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
o=Odoo(load_env(ENV_PATH))
for m in o.kw("ir.module.module","search_read",[[["name","=","deniz_clearance"]]],{"fields":["latest_version"]}): print("MOD",m["latest_version"])
L=o.kw("deniz.clearance.item","search_read",[[["state","in",["suggested","active","due","floor"]],["rule_id.mechanism","=","cost"]]],{"fields":["display_code","state","step_no","current_price","base_price","proposed_price","qty","cdn_url","cdn_pending","write_date"]})
full=[l for l in L if l["step_no"]==0 and (l["current_price"] or l["proposed_price"] or 0)>=(l["base_price"] or 1)]
print("OPEN",len(L),"FULLPRICE",len(full),C.Counter(l["state"] for l in full),"with_image",sum(bool(l["cdn_url"]) for l in full),"pending",sum(bool(l["cdn_pending"]) for l in full),"pieces",sum(l["qty"] for l in full))
print([ (l["display_code"],l["current_price"] or l["proposed_price"]) for l in full[:15]])
