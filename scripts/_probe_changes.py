import os,sys,re,json,collections as C
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo,load_env,ENV_PATH
o=Odoo(load_env(ENV_PATH))
def sr(m,dom,f,ctx=None):
    try: return o.kw(m,"search_read",[dom],{"fields":f,**({"context":ctx} if ctx else {})})
    except Exception as e: print("DENIED",m,str(e)[:150]); return []
strip=lambda h: re.sub(r"\s+"," ",re.sub(r"<[^>]+>"," ",h or "")).strip()
num=lambda s: int(s.replace(",","")) if s else None
res={}
for model in ("product.template","deniz.liquidation.item","deniz.clearance.item"):
    ms=sr("mail.message",[["model","=",model],["date",">=","2026-11-15 21:00:00"],["message_type","in",["comment","notification"]]],["date","res_id","record_name","body","author_id"])
    res[model]=[{"d":m["date"],"id":m["res_id"],"rec":m["record_name"],"by":(m["author_id"] or [0,""])[1],"b":strip(m["body"])[:300]} for m in ms if strip(m["body"])]
    print("===",model,len(res[model]))
    # cluster by first 40 chars pattern (digits removed) and hour
    pat=C.Counter((re.sub(r"[\d,]+","#",x["b"])[:70], x["d"][:13]) for x in res[model])
    for (p,h),n in sorted(pat.items(), key=lambda z:(z[0][1],-z[1]))[:80]:
        if n>=3: print(" ",h,n,"|",p)
json.dump(res,open("/tmp/msgs.json","w"),ensure_ascii=False)
# caption corrections with numbers
cap=[x for x in res["product.template"] if "سعر المنشور تصحح" in x["b"]]
pairs=[]
for x in cap:
    m=re.search(r"من ([\d,]+) إلى ([\d,]+)",x["b"])
    if m: pairs.append((x["d"][:16],x["rec"],num(m.group(1)),num(m.group(2))))
print("=== caption corrections",len(pairs),"up",sum(1 for p in pairs if p[3]>p[2]))
for p in pairs: print("CAP",*p)
# templates list price now for converted: liq_discount_on false & liq_base_price>0
for x in res["product.template"]:
    if x["b"].startswith("قطعة أخيرة: سعر الموديل"):
        m=re.search(r"سعر الموديل ([\d,]+)",x["b"]); print("CONV",x["d"][:16],"|",x["rec"],"|",num(m.group(1)) if m else "")
for x in res["deniz.liquidation.item"]:
    if "اعتمد" in x["b"] or "سلم الكلفة" in x["b"] or "سعر واحد" in x["b"]:
        print("LIQ",x["d"][:16],"|",x["rec"],"|",x["b"][:160])
for x in res["deniz.clearance.item"]:
    if "سعر واحد" in x["b"]: print("ONEP",x["d"][:16],"|",x["rec"],"|",x["b"][:120])
