#!/usr/bin/env python3
"""Builds public/data/profit.json — the inputs of the Real Profit page that
live.json does not carry:

  odoo.expenses   posted journal items on the fixed-cost accounts, one row
                  per (date, group): salaries, turkey (agent expenses),
                  shipping (cargo), other (any other expense account), plus
                  drawings (owner/shareholder withdrawals — shown, never
                  subtracted from profit).
  odoo.monthly    Odoo's own P&L per calendar month (income, COGS, all other
                  expenses) so the page can show "Odoo says vs real".
  meta.daily      account-level Meta spend per day, USD.

What is deliberately NOT read from accounting (and why):
  500101 COGS        customer returns do not reverse COGS in this Odoo setup
                     (verified Jul–Sep 2026: the gap equals the cost of
                     returned goods), so goods cost is computed from the
                     delivered order lines in live.json instead.
  600111 ads         Meta bills stopped being posted on 2026-09-08 — the
                     page uses Meta's daily spend.
  600120 / 400221    courier cost and delivery income — the page applies the
                     confirmed +1,000 IQD net per delivered order.

Read-only against both APIs. Each half has its own failure path: an Odoo
error leaves odoo.error set and the Meta half still runs (and vice versa).
The script always exits 0 so it can never block the data commit.

Env: ODOO_URL ODOO_DB ODOO_USER ODOO_API_KEY META_ACCESS_TOKEN
     META_AD_ACCOUNT_ID
"""

import datetime as dt
import json
import os
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "data", "profit.json")

SINCE = "2026-06-01"          # first month with complete data on both sides
RPC_TIMEOUT = 120
META_API = "https://graph.facebook.com/v21.0"

# Account code → page group. Codes verified against the Odoo chart of
# accounts on 2026-10-20 (diagnostics run).
GROUPS = {
    "600102": "salaries",     # رواتب وأجور (Turkey-side staff)
    "600130": "salaries",     # مصاريف الرواتب والأجور (Baghdad staff)
    "501120": "turkey",       # Turkey Expenses (agent: Mustafa Coskun)
    "501115": "shipping",     # Shipping (cargo: AL HAZIM, SAMA ALNAHRIN, RAFIDAIN)
}
DRAWINGS = {"300103"}         # مسحوبات مساهم - ابو سلطان (equity)
# Expense accounts replaced by better sources (see module docstring).
REPLACED = {"500101", "600111", "600120"}
EXPENSE_TYPES = ["expense", "expense_direct_cost", "expense_depreciation"]
INCOME_TYPES = ["income", "income_other"]


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


class Odoo:
    """Same JSON-RPC pattern as scripts/odoo_sync.py."""

    def __init__(self):
        self.url = os.environ["ODOO_URL"].rstrip("/")
        self.db = os.environ["ODOO_DB"]
        self.key = os.environ["ODOO_API_KEY"]
        self._id = 0
        self.uid = self._rpc("common", "authenticate",
                             [self.db, os.environ["ODOO_USER"], self.key, {}])
        if not isinstance(self.uid, int) or self.uid <= 0:
            raise RuntimeError("Odoo authentication failed")

    def _rpc(self, service, method, args):
        self._id += 1
        payload = {"jsonrpc": "2.0", "method": "call", "id": self._id,
                   "params": {"service": service, "method": method,
                              "args": args}}
        req = urllib.request.Request(
            self.url + "/jsonrpc", data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=RPC_TIMEOUT) as r:
            res = json.load(r)
        if "error" in res:
            data = res["error"].get("data", {})
            raise RuntimeError(f"Odoo RPC error: {data.get('message', res['error'])}")
        return res["result"]

    def kw(self, model, method, args, kwargs=None):
        return self._rpc("object", "execute_kw",
                         [self.db, self.uid, self.key, model, method, args,
                          kwargs or {}])


def name_of(v):
    if isinstance(v, (list, tuple)) and len(v) == 2:
        v = v[1]
    if isinstance(v, dict):
        v = next(iter(v.values()), "")
    return v or ""


def month_ranges(since, until):
    """[(\"YYYY-MM\", first_day, last_day_clipped)] from since..until."""
    d = dt.date.fromisoformat(since).replace(day=1)
    end = dt.date.fromisoformat(until)
    out = []
    while d <= end:
        nxt = (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        last = min(nxt - dt.timedelta(days=1), end)
        out.append((d.strftime("%Y-%m"), d.isoformat(), last.isoformat()))
        d = nxt
    return out


def fetch_odoo(today):
    odoo = Odoo()
    posted = ["parent_state", "=", "posted"]

    accounts = odoo.kw("account.account", "search_read",
                       [[["account_type", "in",
                          EXPENSE_TYPES + INCOME_TYPES + ["equity"]]]],
                       {"fields": ["code", "name", "account_type"]})
    acc = {a["id"]: {"code": a.get("code") or "", "name": name_of(a.get("name")),
                     "type": a.get("account_type")} for a in accounts}

    def group_for(a):
        if a["code"] in GROUPS:
            return GROUPS[a["code"]]
        if a["code"] in DRAWINGS:
            return "drawings"
        if a["type"] in EXPENSE_TYPES and a["code"] not in REPLACED:
            return "other"
        return None

    wanted = [i for i, a in acc.items() if group_for(a)]
    lines = odoo.kw("account.move.line", "search_read",
                    [[posted, ["date", ">=", SINCE], ["date", "<=", today],
                      ["account_id", "in", wanted]]],
                    {"fields": ["date", "account_id", "balance", "name",
                                "partner_id"],
                     "order": "date asc", "limit": 50000})
    log(f"  {len(lines)} expense / drawings journal items")

    daily = {}            # date -> group -> IQD
    other_detail = {}     # "code name" -> IQD (so 'other' is never a black box)
    for ln in lines:
        a = acc.get(ln["account_id"][0]) if ln.get("account_id") else None
        if not a:
            continue
        g = group_for(a)
        amount = ln.get("balance") or 0.0
        row = daily.setdefault(ln["date"], {})
        row[g] = row.get(g, 0.0) + amount
        if g == "other":
            k = f"{a['code']} {a['name']}"
            other_detail[k] = other_detail.get(k, 0.0) + amount

    # Odoo's own monthly P&L (for the reconciliation panel).
    monthly = {}
    for key, first, last in month_ranges(SINCE, today):
        rows = odoo.kw("account.move.line", "read_group",
                       [[posted, ["date", ">=", first], ["date", "<=", last],
                         ["account_id.account_type", "in",
                          EXPENSE_TYPES + INCOME_TYPES]],
                        ["balance:sum"], ["account_id"]],
                       {"lazy": False})
        m = {"income": 0.0, "cogs": 0.0, "expenses": 0.0, "ads": 0.0}
        for r in rows:
            a = acc.get(r["account_id"][0]) if r.get("account_id") else None
            if not a:
                continue
            bal = r.get("balance", 0.0) or 0.0
            if a["type"] in INCOME_TYPES:
                m["income"] += -bal
            elif a["code"] == "500101":
                m["cogs"] += bal
            elif a["code"] == "600111":
                m["ads"] += bal
            else:
                m["expenses"] += bal
        monthly[key] = {k: round(v) for k, v in m.items()}

    return {
        "error": None,
        "since": SINCE,
        "groups": {"salaries": sorted(c for c, g in GROUPS.items() if g == "salaries"),
                   "turkey": sorted(c for c, g in GROUPS.items() if g == "turkey"),
                   "shipping": sorted(c for c, g in GROUPS.items() if g == "shipping"),
                   "drawings": sorted(DRAWINGS),
                   "excluded": sorted(REPLACED)},
        "daily": {d: {g: round(v) for g, v in row.items()}
                  for d, row in sorted(daily.items())},
        "otherByAccount": {k: round(v) for k, v in
                           sorted(other_detail.items(), key=lambda x: -abs(x[1]))},
        "monthly": monthly,
    }


def fetch_meta(today):
    token = os.environ.get("META_ACCESS_TOKEN", "").strip()
    account = os.environ.get("META_AD_ACCOUNT_ID", "").strip().replace("act_", "")
    if not token or not account:
        raise RuntimeError("META_ACCESS_TOKEN / META_AD_ACCOUNT_ID not set")
    params = {"level": "account", "time_increment": "1", "fields": "spend",
              "time_range": json.dumps({"since": SINCE, "until": today}),
              "limit": "500", "access_token": token}
    url = f"{META_API}/act_{account}/insights?{urllib.parse.urlencode(params)}"
    daily = {}
    while url:
        req = urllib.request.Request(url, headers={"User-Agent": "pulsestock-profit/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            payload = json.load(r)
        if "error" in payload:
            raise RuntimeError(payload["error"].get("message", "meta api error"))
        for row in payload.get("data", []):
            daily[row["date_start"]] = round(float(row.get("spend") or 0), 2)
        url = payload.get("paging", {}).get("next")
    log(f"  {len(daily)} days of Meta spend")
    return {"error": None, "currency": "USD", "since": SINCE,
            "tz": "ad account timezone", "daily": dict(sorted(daily.items()))}


def main():
    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=3)))  # Asia/Baghdad
    today = now.date().isoformat()
    out = {"syncedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
           "currency": "IQD", "tz": "Asia/Baghdad"}

    log("profit: Odoo expenses…")
    try:
        out["odoo"] = fetch_odoo(today)
    except Exception as e:                      # keep last good data visible
        log(f"  Odoo failed: {e}")
        out["odoo"] = {"error": str(e)}

    log("profit: Meta daily spend…")
    try:
        out["meta"] = fetch_meta(today)
    except Exception as e:
        log(f"  Meta failed: {e}")
        out["meta"] = {"error": str(e)}

    # On a failed half, carry the previous successful half forward so one
    # flaky API call never blanks the page.
    try:
        with open(OUT) as f:
            prev = json.load(f)
        for half in ("odoo", "meta"):
            if out[half].get("error") and prev.get(half, {}).get("daily"):
                kept = dict(prev[half])
                kept["error"] = out[half]["error"]
                kept["stale"] = True
                out[half] = kept
    except (OSError, ValueError):
        pass

    with open(OUT, "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    log(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    main()
