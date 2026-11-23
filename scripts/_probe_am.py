# READ-ONLY morning resale probe (search_read / search_count only). Never writes.
import os,sys,json,csv,io,re,urllib.request
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
o=Odoo(load_env(ENV_PATH))
R={}
def sr(m,dom,f,**kw):
    try: return o.kw(m,"search_read",[dom],dict({"fields":f},**kw))
    except Exception as e: R.setdefault("errs",[]).append(f"{m}: {str(e)[:200]}"); return []
def norm(s): return "".join(c for c in str(s).upper() if c.isascii() and c.isalnum())
its=sr("deniz.clearance.item",[["state","in",["suggested","active","due","floor","paused"]]],
  ["display_code","state","step_no","qty","feed_code","cdn_url","cdn_pending","cdn_error","product_tmpl_id","current_price","base_price"])
att=sr("ir.attachment",[["res_model","=","deniz.clearance.item"],["res_field","=","image"]],["res_id"])
has_img={a["res_id"] for a in att}
try:
    with urllib.request.urlopen("https://docs.google.com/spreadsheets/d/1EaE2karm7nAJ5YoNPuBQdWND1t5fSufRlnoyFukZt5g/export?format=csv&gid=0",timeout=60) as r: txt=r.read().decode()
    rows=list(csv.DictReader(io.StringIO(txt)))
except Exception as e: rows=[]; R["sheetErr"]=str(e)[:200]
R["sheetRows"]=len(rows); R["sheetCols"]=list(rows[0].keys()) if rows else []
sheet={norm(r.get("id","")):r for r in rows if r.get("id")}
out=[]
for i in its:
    s=sheet.get(norm(i["feed_code"] or ""))
    out.append({"c":i["display_code"],"st":i["state"],"s":i["step_no"],"q":i["qty"],"img":i["id"] in has_img,"cdn":bool(i["cdn_url"]),
      "pend":i["cdn_pending"],"err":i["cdn_error"] or None,"t":i["product_tmpl_id"] and i["product_tmpl_id"][0],"p":i["current_price"],"full":i["base_price"],
      "sheet":bool(s),"sAv":s and s.get("availability"),"sP":s and s.get("price"),"sSP":s and s.get("sale_price"),"sImg":bool(s and s.get("image_link"))})
R["items"]=out
R["sheetCLR"]=[{"id":r.get("id"),"av":r.get("availability"),"p":r.get("price"),"sp":r.get("sale_price"),"img":bool(r.get("image_link")),"lab":r.get("custom_label_0")} for r in rows if "CLR" in norm(r.get("id",""))]
R["oneprice"]=[{"id":t["id"],"n":t["name"],"po":t["purchase_ok"]} for t in sr("product.template",[["deniz_oneprice_on","=",True]],["name","purchase_ok"])]
R["crons"]=sr("ir.cron",[["ir_actions_server_id.model_id.model","in",["deniz.clearance.item","deniz.clearance.rule","product.template"]]],["name","active","lastcall","nextcall","failure_count","first_failure_date"])
R["logs"]=[{"d":l["create_date"],"lvl":l["level"],"n":l["name"],"m":(l["message"] or "")[:300]} for l in sr("ir.logging",[["create_date",">=","2026-11-21 00:00:00"],["level","in",["ERROR","WARNING"]]],["create_date","level","name","message"],limit=60,order="id desc")]
import collections as C
A={}
items=R.pop("items")
A["byStSt"]=C.Counter(f'{x["st"]}/{x["s"]}' for x in items)
for k in ["img","cdn","pend","sheet","sImg"]:
    A[k]=C.Counter(f'{x["st"]}/{x["s"]}:{bool(x[k])}' for x in items)
A["sheetAv"]=C.Counter(f'{x["st"]}/{x["s"]}:{x["sAv"]}' for x in items)
A["errs"]=C.Counter(x["err"] for x in items if x["err"]).most_common(8)
A["s0noSheet"]=[x["c"] for x in items if x["s"]==0 and x["st"]=="active" and not x["sheet"]][:60]
A["s0priceMismatch"]=[(x["c"],x["p"],x["full"],x["sP"],x["sSP"]) for x in items if x["s"]==0 and x["st"]=="active" and x["sheet"] and (x["sSP"] or "").strip()][:30]
A["floor"]=[(x["c"],x["p"],x["sheet"],x["sAv"],x["sP"],x["sSP"]) for x in items if x["st"]=="floor"]
clr=R.pop("sheetCLR")
A["sheetCLR"]=C.Counter(f'{c["av"]}:img={c["img"]}' for c in clr)
codes={x["c"] for x in items}
A["oneprice"]=[(t["n"],t["po"]) for t in R.pop("oneprice")]
R["A"]=A
print("PROBE_BEGIN")
for k,v in R.items(): print("K|"+k+"|"+json.dumps(v,ensure_ascii=False,default=str))
print("PROBE_END")
