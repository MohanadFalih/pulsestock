import os,sys
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
o=Odoo(load_env(ENV_PATH))
for m in o.kw("ir.module.module","search_read",[[["name","in",["deniz_catalog","deniz_anasgram"]]]],{"fields":["name","latest_version","state"]}): print("MOD",m)
for code in ("H-1945","T-6990"):
    try:
        r=o.kw("deniz.anasgram","ask",[code])
        rep=r.get("reply") or {}
        print("=== CAPTION",code); print(rep.get("caption"))
        print("=== INFO",code); print("\n".join(rep.get("info") or []))
    except Exception as e: print("ERR",code,str(e)[:300])
