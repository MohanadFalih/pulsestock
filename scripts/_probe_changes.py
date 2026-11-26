import os,sys
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
o=Odoo(load_env(ENV_PATH))
print("MOD",o.kw("ir.module.module","search_read",[[["name","in",["deniz_liquidation","deniz_prep"]]]],{"fields":["name","latest_version"]}))
d=o.kw("sale.order","search_read",[[["state","in",["draft","sent"]],["create_date",">=","2026-11-26 00:00:00"]]],{"fields":["name","deniz_lines_summary"],"limit":8})
for x in d: print("SO",x["name"],x["deniz_lines_summary"])
