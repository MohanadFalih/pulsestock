#!/usr/bin/env python3
"""Meta ads executor (phase 1) — pause / activate / set daily budget.

Reads ops/meta_queue.json, executes every action whose id is not yet in
ops/meta_exec_log.json, and appends one log entry per action (done or
rejected, with the reason). Never deletes anything, never touches prices,
audiences, creatives or catalogs.

Credentials (repo secrets, never in files or chat):
  META_WRITE_TOKEN   – System User token with ads_management
  META_AD_ACCOUNT_ID – same secret the read-only sync uses
Kill switch (repo variable): META_EXEC_ENABLED must equal "true".

Queue format:
  {"actions": [
     {"id": "2026-11-26-01", "op": "pause",      "target": "<ad|adset id>", "why": "..."},
     {"id": "2026-11-26-02", "op": "activate",   "target": "<ad|adset id>", "why": "..."},
     {"id": "2026-11-26-03", "op": "set_budget", "target": "<adset id>", "usd": 14.4, "why": "..."}
  ]}

Guards:
  * target must belong to META_AD_ACCOUNT_ID
  * set_budget: raise at most +20% over the current budget, at most one raise
    per ad set per Baghdad day; cuts are always allowed (min 1$)
  * any activate / raise that would push the account's total active daily
    budget above CEILING_USD is rejected
  * only ad sets with their own daily budget (no CBO, no lifetime budget)
"""
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUEUE = os.path.join(ROOT, "ops", "meta_queue.json")
LOG = os.path.join(ROOT, "ops", "meta_exec_log.json")

API_VERSION = "v21.0"
BASE = f"https://graph.facebook.com/{API_VERSION}"
TOKEN = os.environ.get("META_WRITE_TOKEN", "").strip()
ACCOUNT = os.environ.get("META_AD_ACCOUNT_ID", "").strip().replace("act_", "")
ENABLED = os.environ.get("META_EXEC_ENABLED", "").strip().lower() == "true"
CEILING_USD = float(os.environ.get("META_EXEC_CEILING", "650"))
MAX_RAISE = 0.20
BAGHDAD = dt.timezone(dt.timedelta(hours=3))


class Reject(Exception):
    pass


def call(method, path, params=None):
    params = dict(params or {}, access_token=TOKEN)
    data = None
    url = f"{BASE}/{path}"
    if method == "GET":
        url += "?" + urllib.parse.urlencode(params)
    else:
        data = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"User-Agent": "pulsestock-exec/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            payload = json.load(r)
    except urllib.error.HTTPError as e:
        try:
            payload = json.load(e)
        except Exception:
            raise RuntimeError(f"HTTP {e.code}")
    if isinstance(payload, dict) and "error" in payload:
        er = payload["error"]
        raise RuntimeError(" | ".join(str(x) for x in (er.get("message"), er.get("error_subcode"),
                                                       er.get("error_user_title"), er.get("error_user_msg")) if x))
    return payload


def get_all(path, params):
    out, after = [], None
    while True:
        p = dict(params, limit=200)
        if after:
            p["after"] = after
        page = call("GET", path, p)
        out.extend(page.get("data", []))
        after = page.get("paging", {}).get("cursors", {}).get("after")
        if not page.get("paging", {}).get("next"):
            return out


def money_factor():
    acc = call("GET", f"act_{ACCOUNT}", {"fields": "currency"})
    if acc.get("currency") != "USD":
        raise SystemExit(f"account currency is {acc.get('currency')}, expected USD")
    return 100  # USD minor units (cents)


def active_daily_total(cents):
    """Sum of daily budgets that are actually spending: ACTIVE ad sets with
    their own budget inside ACTIVE campaigns, plus ACTIVE CBO campaigns."""
    camps = get_all(f"act_{ACCOUNT}/campaigns",
                    {"fields": "id,effective_status,daily_budget"})
    active_camps = {c["id"]: c for c in camps if c.get("effective_status") == "ACTIVE"}
    total = sum(int(c.get("daily_budget") or 0) for c in active_camps.values())
    sets = get_all(f"act_{ACCOUNT}/adsets",
                   {"fields": "id,campaign_id,status,daily_budget"})
    for s in sets:
        if s.get("status") == "ACTIVE" and s.get("campaign_id") in active_camps \
                and not active_camps[s["campaign_id"]].get("daily_budget"):
            total += int(s.get("daily_budget") or 0)
    return total / cents


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def obj(target):
    o = call("GET", target, {"fields": "id,name,status,account_id"})
    if str(o.get("account_id", "")).replace("act_", "") != ACCOUNT:
        raise Reject("target is not in our ad account")
    return o


def inspect(ad_id):
    """Read-only: structure of one ad, its ad set, campaign and creative."""
    ad = call("GET", ad_id, {"fields": "id,name,status,account_id,adset_id,campaign_id,creative{id,name,object_story_id,effective_object_story_id,object_type,video_id,image_hash,call_to_action_type,asset_feed_spec,object_story_spec,degrees_of_freedom_spec}"})
    if str(ad.get("account_id", "")).replace("act_", "") != ACCOUNT:
        raise Reject("target is not in our ad account")
    st = call("GET", ad["adset_id"], {"fields": "id,name,status,daily_budget,lifetime_budget,optimization_goal,billing_event,bid_strategy,destination_type,promoted_object,attribution_spec,targeting"})
    cp = call("GET", ad["campaign_id"], {"fields": "id,name,objective,daily_budget,buying_type,special_ad_categories"})
    n = len(get_all(f"{ad['campaign_id']}/adsets", {"fields": "id"}))
    return {"inspect": {"ad": ad, "adset": st, "campaign": cp, "adsetsInCampaign": n}}


PAGE_ID = "115435042437123"
_page_token = None


def page_token():
    global _page_token
    if _page_token is None:
        _page_token = call("GET", PAGE_ID, {"fields": "access_token"}).get("access_token") or TOKEN
    return _page_token


def find_posts(code, limit_pages=6):
    """Read-only: page posts whose text contains the model code (newest first)."""
    import re
    norm = lambda t: re.sub(r"\s+", "", (t or "").upper())
    want = norm(code)
    out, after = [], None
    for _ in range(limit_pages):
        p = {"fields": "id,message,created_time,status_type", "limit": 100, "access_token": page_token()}
        if after:
            p["after"] = after
        url = f"{BASE}/{PAGE_ID}/posts?" + urllib.parse.urlencode(p)
        with urllib.request.urlopen(urllib.request.Request(url), timeout=30) as r:
            page = json.load(r)
        for x in page.get("data", []):
            m = norm(x.get("message"))
            if re.search(r"(?<![A-Z0-9])" + re.escape(want) + r"(?![0-9])", m):
                out.append({"id": x["id"], "at": x.get("created_time"), "type": x.get("status_type")})
        after = page.get("paging", {}).get("cursors", {}).get("after")
        if not page.get("paging", {}).get("next"):
            break
    return out


def inspect_set(adset_id):
    """Read-only: every ad in an ad set with all of its creatives."""
    st = call("GET", adset_id, {"fields": "id,name,account_id"})
    if str(st.get("account_id", "")).replace("act_", "") != ACCOUNT:
        raise Reject("target is not in our ad account")
    ads = get_all(f"{adset_id}/ads", {"fields": "id,name,status,tracking_specs,conversion_specs"})
    for a in ads:
        a["creatives"] = get_all(f"{a['id']}/adcreatives", {"fields": "id,object_story_id,object_type,asset_feed_spec,object_story_spec,video_id,url_tags"})
    return {"adset": st, "ads": ads}


TEST_TEMPLATE_ADSET = "120253586159010723"   # TEST H-1980 (paused) — settings source
TEST_TEMPLATE_AD = "120253586159070723"
TEST_BUDGET_USD = 6.0
MAX_POSTS = 3


def create_test(a, cents):
    """Clone the TEST template ad set for one model code, one ad per post
    (Meta's API exposes one post per ad), 6$/day, offline-event tracking kept."""
    code = a["code"].strip().upper()
    tpl = call("GET", TEST_TEMPLATE_ADSET, {"fields": "id,campaign_id,account_id"})
    if str(tpl.get("account_id", "")).replace("act_", "") != ACCOUNT:
        raise Reject("template not in our account")
    camp = tpl["campaign_id"]
    existing = get_all(f"{camp}/adsets", {"fields": "id,name,effective_status"})
    if not a.get("reuse_adset") and any(x["name"].strip().upper() == f"TEST {code}" for x in existing):
        raise Reject(f"ad set 'TEST {code}' already exists")
    posts = a.get("posts") or [p["id"] for p in find_posts(code)][:MAX_POSTS]
    if not posts:
        raise Reject(f"no page post found for {code}")
    total = active_daily_total(cents)
    if total + TEST_BUDGET_USD > CEILING_USD:
        raise Reject(f"ceiling: {total:.0f}+{TEST_BUDGET_USD:.0f} > {CEILING_USD:.0f}$")

    tad = call("GET", TEST_TEMPLATE_AD, {"fields": "tracking_specs,creative{asset_feed_spec,degrees_of_freedom_spec}"})
    afs = tad["creative"]["asset_feed_spec"]
    dof = tad["creative"].get("degrees_of_freedom_spec")
    tracking = [t for t in tad.get("tracking_specs", []) if "post" not in t and "post.wall" not in t]
    if not any("offline_conversion" in t.get("action.type", []) for t in tracking):
        tracking.append({"action.type": ["offline_conversion"], "dataset": ["950131427639553"]})

    new_set = a.get("reuse_adset") or call("POST", f"{TEST_TEMPLATE_ADSET}/copies",
                   {"deep_copy": "false", "status_option": "PAUSED"})["copied_adset_id"]
    out = {"adset": new_set, "ads": []}
    step = "rename"
    try:
        call("POST", new_set, {"name": f"TEST {code}"})
        step = "budget"
        cur = int(call("GET", new_set, {"fields": "daily_budget"}).get("daily_budget") or 0)
        if cur != int(TEST_BUDGET_USD * cents):
            time.sleep(35)
            call("POST", new_set, {"daily_budget": str(int(TEST_BUDGET_USD * cents))})
        for i, post in enumerate(posts, 1):
            cp = {"name": f"{code} {i}", "object_story_id": post, "asset_feed_spec": json.dumps(afs)}
            if dof:
                cp["degrees_of_freedom_spec"] = json.dumps(dof)
            step = f"creative {i}"
            cr = call("POST", f"act_{ACCOUNT}/adcreatives", cp)["id"]
            step = f"ad {i}"
            ad = call("POST", f"act_{ACCOUNT}/ads", {
                "name": code if len(posts) == 1 else f"{code} {i}", "adset_id": new_set,
                "creative": json.dumps({"creative_id": cr}), "status": "ACTIVE",
                "tracking_specs": json.dumps(tracking)})["id"]
            out["ads"].append({"ad": ad, "post": post})
        step = "activate"
        call("POST", new_set, {"status": "ACTIVE"})
    except Exception as x:
        out["error_after_copy"] = f"{step}: {str(x)[:400]}"
        try:
            call("POST", new_set, {"status": "PAUSED"})
        except Exception:
            pass
        raise RuntimeError(json.dumps(out))
    chk = call("GET", out["ads"][0]["ad"], {"fields": "tracking_specs,effective_status"})
    out["offline_tracking"] = any("offline_conversion" in t.get("action.type", []) for t in chk.get("tracking_specs", []))
    out["status"] = chk.get("effective_status")
    return out


def raised_today(log, target, today):
    return any(e.get("op") == "set_budget" and e.get("target") == target
               and e.get("result") == "done" and e.get("raise")
               and e.get("day") == today for e in log)


def run_action(a, log, cents, today):
    op, target = a.get("op"), str(a.get("target", ""))
    if op == "inspect":
        return inspect(target)
    if op == "create_test":
        return create_test(a, cents)
    if op == "raw":  # read-only GET of one object with chosen fields
        return {"raw": call("GET", target, {"fields": a.get("fields", "id,name")})}
    if op == "inspect_set":
        return inspect_set(target)
    if op == "find_posts":
        return {"posts": find_posts(target)}
    if op not in ("pause", "activate", "set_budget") or not target:
        raise Reject(f"unsupported op {op!r}")
    o = obj(target)
    entry = {"name": o.get("name")}

    if op == "pause":
        if o.get("status") == "PAUSED":
            entry["note"] = "already paused"
            return entry
        call("POST", target, {"status": "PAUSED"})
        return entry

    if op == "activate":
        if o.get("status") == "ACTIVE":
            entry["note"] = "already active"
            return entry
        # adding a whole ad set adds its budget; an ad inside an active set adds nothing
        try:
            add = int(call("GET", target, {"fields": "daily_budget"}).get("daily_budget") or 0) / cents
        except RuntimeError:
            add = 0  # an ad: no budget field
        if add:
            total = active_daily_total(cents)
            if total + add > CEILING_USD:
                raise Reject(f"ceiling: {total:.0f}+{add:.0f} > {CEILING_USD:.0f}$")
        call("POST", target, {"status": "ACTIVE"})
        return entry

    # set_budget
    s = call("GET", target, {"fields": "daily_budget,lifetime_budget"})
    if not s.get("daily_budget") or s.get("lifetime_budget") not in (None, "0", 0):
        raise Reject("ad set has no own daily budget (CBO or lifetime)")
    cur = int(s["daily_budget"]) / cents
    new = round(float(a["usd"]), 2)
    if new < 1:
        raise Reject("budget below 1$")
    entry.update(old_usd=cur, new_usd=new)
    if new > cur:
        if new > cur * (1 + MAX_RAISE) + 0.01:
            raise Reject(f"raise {cur}->{new} exceeds +20%")
        if raised_today(log, target, today):
            raise Reject("already raised today")
        if o.get("status") == "ACTIVE":
            total = active_daily_total(cents)
            if total - cur + new > CEILING_USD:
                raise Reject(f"ceiling: {total - cur + new:.0f} > {CEILING_USD:.0f}$")
        entry["raise"] = True
    call("POST", target, {"daily_budget": str(int(round(new * cents)))})
    return entry


def main():
    queue = load(QUEUE, {"actions": []})
    log = load(LOG, [])
    done_ids = {e.get("id") for e in log}
    todo = [a for a in queue.get("actions", []) if a.get("id") not in done_ids]
    if not todo:
        print("nothing to do")
        return
    if not ENABLED:
        print("META_EXEC_ENABLED is not 'true' — kill switch on, nothing executed")
        return
    if not TOKEN or not ACCOUNT:
        sys.exit("missing META_WRITE_TOKEN or META_AD_ACCOUNT_ID")
    cents = money_factor()
    now = dt.datetime.now(BAGHDAD)
    today = now.date().isoformat()
    for a in todo:
        e = {"id": a.get("id"), "op": a.get("op"), "target": str(a.get("target", "")),
             "why": a.get("why", ""), "at": now.isoformat(timespec="minutes"), "day": today}
        try:
            e.update(run_action(a, log, cents, today))
            e["result"] = "done"
        except Reject as r:
            e.update(result="rejected", reason=str(r))
        except Exception as x:
            e.update(result="error", reason=str(x)[:300])
        log.append(e)
        print(json.dumps(e, ensure_ascii=False))
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "w", encoding="utf-8") as f:
        json.dump(log, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
