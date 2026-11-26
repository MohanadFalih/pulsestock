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
        raise RuntimeError(payload["error"].get("message", "meta api error"))
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


def raised_today(log, target, today):
    return any(e.get("op") == "set_budget" and e.get("target") == target
               and e.get("result") == "done" and e.get("raise")
               and e.get("day") == today for e in log)


def run_action(a, log, cents, today):
    op, target = a.get("op"), str(a.get("target", ""))
    if op == "inspect":
        return inspect(target)
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
