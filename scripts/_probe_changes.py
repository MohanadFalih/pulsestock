import os,sys
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
o=Odoo(load_env(ENV_PATH))
for code in ("M-2154","H-1909","L-1153"):
    r=o.kw("deniz.anasgram","ask",[code]); rep=r.get("reply") or {}
    print("=== CAPTION",code); print(rep.get("caption")); print("--- INFO"); print("\n".join((rep.get("info") or [])[:3]))
