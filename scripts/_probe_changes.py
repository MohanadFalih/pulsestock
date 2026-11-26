import os,sys,json,collections as C,urllib.request,csv,io
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import meta_campaigns as M
rows=M.get_all("120252218976640723/adsets",{"fields":"id,name,status,effective_status,daily_budget,created_time,promoted_object","limit":"50"})
for r in rows: print("ADSET",r.get("id"),r.get("name"),r.get("effective_status"),r.get("daily_budget"),r.get("created_time"),json.dumps(r.get("promoted_object") or {})[:150])
u="https://docs.google.com/spreadsheets/d/1EaE2karm7nAJ5YoNPuBQdWND1t5fSufRlnoyFukZt5g/export?format=csv&gid=0"
r=list(csv.DictReader(io.StringIO(urllib.request.urlopen(u,timeout=60).read().decode("utf-8"))))
print("SHEET",C.Counter(x.get("custom_label_1") for x in r if x.get("availability")=="in stock"))
