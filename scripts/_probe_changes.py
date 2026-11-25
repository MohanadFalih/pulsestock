import os,sys,collections as C
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
o=Odoo(load_env(ENV_PATH))
print("MOD",o.kw("ir.module.module","search_read",[[["name","=","deniz_clearance"]]],{"fields":["latest_version"]}))
for m in ("deniz.liquidation.item","deniz.clearance.item"):
    st=[("state","=","live")] if "liquid" in m else [("state","in",["active","due","floor"])]
    try: print("VIS",m,o.kw(m,"read_group",[[list(x) for x in st],["vis_state"],["vis_state"]],{"lazy":False}))
    except Exception as e: print("ERR",str(e)[:200])
try: print("CRON",o.kw("ir.cron","search_read",[[["name","ilike","مشاهدة"]]],{"fields":["nextcall","lastcall","active"]}))
except Exception as e: print("ERRC",str(e)[:150])
