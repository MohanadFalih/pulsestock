import os,sys,collections as C,urllib.request,csv,io
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
o=Odoo(load_env(ENV_PATH))
print("MOD",o.kw("ir.module.module","search_read",[[["name","=","deniz_clearance"]]],{"fields":["latest_version"]})[0]["latest_version"])
for m,st in (("deniz.liquidation.item",[["state","=","live"]]),("deniz.clearance.item",[["state","in",["active","due","floor"]]])):
    g=o.kw(m,"read_group",[st,["vis_state"],["vis_state"]],{"lazy":False}); print("VIS",m,[(x["vis_state"],x["__count"]) for x in g])
u="https://docs.google.com/spreadsheets/d/1EaE2karm7nAJ5YoNPuBQdWND1t5fSufRlnoyFukZt5g/export?format=csv&gid=0"
r=list(csv.DictReader(io.StringIO(urllib.request.urlopen(u,timeout=60).read().decode("utf-8"))))
print("SHEET",C.Counter(x.get("custom_label_1") for x in r if x.get("availability")=="in stock"))
