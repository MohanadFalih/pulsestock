import os,sys,collections as C
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
o=Odoo(load_env(ENV_PATH))
r=o.kw("deniz.clearance.rule","search_read",[[["visibility_on","=",True]]],{"fields":["name","vis_seen_imps","vis_seen_clicks","vis_unseen_imps","vis_seen_days","vis_max_days"]}); print("RULE",r)
for m,st,start in (("deniz.liquidation.item",[["state","=","live"]],"ladder_since"),("deniz.clearance.item",[["state","in",["active","due","floor"]]],"stage_start")):
    x=o.kw(m,"search_read",[st],{"fields":["vis_state","vis_imps","vis_clicks",start]})
    def b(v): return "0" if v==0 else "1-149" if v<150 else "150-499" if v<500 else "500+"
    print("DIST",m,C.Counter((i["vis_state"],b(i["vis_imps"]),"c8+" if i["vis_clicks"]>=8 else "c<8") for i in x))
    print("START",m,C.Counter(str(i[start])[:10] for i in x).most_common(6))
