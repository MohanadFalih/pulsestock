import os,sys,json,datetime as dt
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
import meta_campaigns as M
o=Odoo(load_env(ENV_PATH))
today=dt.date.today(); since=today-dt.timedelta(days=27)
for cname in ("LAST PIECES","CATALOG"):
    try:
        rows=M.get_all(f"act_{M.ACCOUNT}/insights",{"level":"campaign","time_increment":"1","breakdowns":"product_id",
            "filtering":json.dumps([{"field":"campaign.name","operator":"CONTAIN","value":cname}]),
            "time_range":json.dumps({"since":since.isoformat(),"until":today.isoformat()}),
            "fields":"campaign_name,spend,impressions,clicks,actions","limit":"500"})
    except Exception as e:
        print("METAERR",cname,str(e)[:300]); continue
    print("METAROWS",cname,len(rows))
    for r in rows:
        pid=str(r.get("product_id") or "").split(",")[0].strip()
        print("MI",r.get("campaign_name"),"|",pid,"|",r.get("date_start"),r.get("impressions"),r.get("clicks"),r.get("spend"))
def sr(m,dom,f,**kw):
    try: return o.kw(m,"search_read",[dom],dict({"fields":f},**kw))
    except Exception as e: print("ERR",m,str(e)[:200]); return []
for c in sr("deniz.clearance.item",[["rule_id.mechanism","=","cost"],["create_date",">=","2026-10-01 00:00:00"]],["feed_code","state","step_no","create_date","applied_at","stage_start","close_date","cdn_url","current_price","base_price","cost_price"]):
    print("CL",c["feed_code"],c["state"],c["step_no"],str(c["create_date"])[:10],str(c.get("applied_at") or "")[:10],c.get("stage_start"),c.get("close_date"),bool(c["cdn_url"]),c["current_price"],c["base_price"])
for it in sr("deniz.liquidation.item",[["published_date","!=",False]],["feed_id","state","published_date","sold_date","sale_price","old_price"],context={"active_test":False}):
    print("LQ",it["feed_id"],it["state"],it["published_date"],it["sold_date"],it["sale_price"],it["old_price"])
