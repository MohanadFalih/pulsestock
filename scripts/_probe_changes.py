import os,sys,re,collections as C
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
o=Odoo(load_env(ENV_PATH))
def sr(m,dom,f):
    try: return o.kw(m,"search_read",[dom],{"fields":f})
    except Exception as e: print("DENIED",m,str(e)[:200]); return []
strip=lambda h: re.sub(r"\s+"," ",re.sub(r"<[^>]+>"," ",h or "")).strip()
codes=["L-1800","H-1951","H-1938","T-8041","H-1945","H-1916","L-1729","T-8014","H-1908"]
F=["name","default_code","list_price","purchase_ok","route_ids","x_supplier_status","catalog_price","liq_discount_on","write_date"]
for c in codes:
    t=sr("product.template",[["default_code","=ilike",c+"%"]],[f for f in F])
    if not t: t=sr("product.template",[["name","ilike",c]],F)
    for x in t[:2]:
        print("TMPL",c,{k:x.get(k) for k in F})
        ms=sr("mail.message",[["model","=","product.template"],["res_id","=",x["id"]],["date",">=","2026-11-14 00:00:00"]],["date","body","tracking_value_ids"])
        for m in ms: print("   MSG",m["date"],strip(m["body"])[:200],m["tracking_value_ids"][:3])
ms=sr("mail.message",[["model","=","product.template"],["date",">=","2026-11-17 18:00:00"],["date","<=","2026-11-18 12:00:00"]],["date","record_name","body","tracking_value_ids"])
pat=C.Counter((m["date"][:13],re.sub(r"[\d,]+","#",strip(m["body"]))[:90]) for m in ms)
for (h,p),n in sorted(pat.items()): print("PAT",h,n,"|",p)
tv=sr("mail.tracking.value",[["create_date",">=","2026-11-17 18:00:00"],["create_date","<=","2026-11-18 12:00:00"]],["field_id","old_value_char","new_value_char","create_date","mail_message_id"])
print("TV",C.Counter(((t["field_id"] or [0,""])[1],t["create_date"][:13]) for t in tv).most_common(20))
