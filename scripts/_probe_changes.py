import os,sys
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
o=Odoo(load_env(ENV_PATH))
f=o.kw("deniz.liquidation.item","fields_get",[],{"attributes":["string","type","selection"]})
for k,v in sorted(f.items()):
    if v["type"] not in ("one2many",) and not k.startswith(("message_","activity_","website_")): print("F",k,v["type"],v["string"],v.get("selection") or "")
print("COUNT",o.kw("deniz.liquidation.item","read_group",[[],["state"],["state"]],{"lazy":False}))
