#!/usr/bin/env python3
"""PulseStock — Odoo accounting diagnostics, round 2 (READ-ONLY).

Explains the numbers found in round 1 before the Real Profit page is built:
  A. Monthly totals Jun–Oct 2026 for every income / expense / COGS account
     (is September's COGS ratio an outlier?)
  B. September vs October COGS split by journal (deliveries & returns vs
     manual adjustments / revaluations)
  C. Largest COGS lines in September that did NOT come from the
     Inventory Valuation journal
  D. Where vendor bills land: totals by vendor x account (ALL account types,
     including balance-sheet accounts) since 2026-08-01 — cargo (Kargo),
     Turkey expenses (Masraflar), supplier receipts, owner draws
  E. Salaries journal lines by account and month
  F. Any rent entries anywhere

Same connection and secrets as scripts/odoo_sync.py. Never writes.
Prints one JSON document between DIAG_JSON_BEGIN / DIAG_JSON_END.
"""

import json
import os
import sys
import time
import urllib.request

RPC_TIMEOUT = 120
REPORT = {}
PNL_TYPES = ["income", "income_other", "expense", "expense_direct_cost",
             "expense_depreciation"]


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


class Odoo:
    def __init__(self, env):
        self.url = env["ODOO_URL"].rstrip("/")
        self.db = env["ODOO_DB"]
        self.key = env["ODOO_API_KEY"]
        self._id = 0
        self.uid = self._rpc("common", "authenticate",
                             [self.db, env["ODOO_USER"], self.key, {}])
        if not isinstance(self.uid, int) or self.uid <= 0:
            raise SystemExit("Authentication failed")

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
            raise RuntimeError(data.get("message", res["error"]))
        return res["result"]

    def kw(self, model, method, args, kwargs=None):
        return self._rpc("object", "execute_kw",
                         [self.db, self.uid, self.key, model, method, args,
                          kwargs or {}])

    def rg(self, model, domain, fields, groupby):
        return self.kw(model, "read_group", [domain, fields, groupby],
                       {"lazy": False})


def name(v):
    if isinstance(v, (list, tuple)) and len(v) == 2:
        v = v[1]
    if isinstance(v, dict):
        v = next(iter(v.values()), "")
    return v


def section(key, fn):
    try:
        REPORT[key] = {"ok": True, "data": fn()}
        log(f"  ok: {key}")
    except Exception as e:
        REPORT[key] = {"ok": False, "error": str(e)}
        log(f"  FAIL: {key} -> {e}")


def main():
    env = {k: os.environ.get(k, "") for k in
           ("ODOO_URL", "ODOO_DB", "ODOO_USER", "ODOO_API_KEY")}
    if not all(env.values()):
        raise SystemExit("missing ODOO_* env vars")
    odoo = Odoo(env)
    posted = ["parent_state", "=", "posted"]

    # A. monthly P&L by account, Jun–Oct 2026
    def monthly():
        rows = odoo.rg("account.move.line",
                       [posted, ["date", ">=", "2026-06-01"],
                        ["date", "<=", "2026-10-19"],
                        ["account_id.account_type", "in", PNL_TYPES]],
                       ["balance:sum"], ["account_id", "date:month"])
        return [{"account": name(r.get("account_id")),
                 "month": r.get("date:month"),
                 "balance": round(r.get("balance", 0.0)),
                 "lines": r.get("__count")} for r in rows]
    section("A_monthly_pnl_by_account", monthly)

    # B. COGS by journal, Sep and Oct 1-19
    def cogs_by_journal(d_from, d_to):
        rows = odoo.rg("account.move.line",
                       [posted, ["date", ">=", d_from], ["date", "<=", d_to],
                        ["account_id.code", "=", "500101"]],
                       ["debit:sum", "credit:sum", "balance:sum"],
                       ["journal_id"])
        return [{"journal": name(r.get("journal_id")),
                 "debit": round(r.get("debit", 0.0)),
                 "credit": round(r.get("credit", 0.0)),
                 "balance": round(r.get("balance", 0.0)),
                 "lines": r.get("__count")} for r in rows]
    section("B_cogs_by_journal_sep", lambda: cogs_by_journal("2026-09-01", "2026-09-30"))
    section("B_cogs_by_journal_oct", lambda: cogs_by_journal("2026-10-01", "2026-10-19"))

    # C. biggest Sep COGS lines outside Inventory Valuation
    def cogs_outliers():
        rows = odoo.kw("account.move.line", "search_read",
                       [[posted, ["date", ">=", "2026-09-01"],
                         ["date", "<=", "2026-09-30"],
                         ["account_id.code", "=", "500101"],
                         ["journal_id.name", "!=", "Inventory Valuation"]]],
                       {"fields": ["date", "move_id", "journal_id", "name",
                                   "ref", "balance"],
                        "order": "balance desc", "limit": 25})
        return [{"date": r.get("date"), "move": name(r.get("move_id")),
                 "journal": name(r.get("journal_id")),
                 "label": r.get("name"), "ref": r.get("ref"),
                 "balance": round(r.get("balance", 0.0))} for r in rows]
    section("C_sep_cogs_non_valuation_lines", cogs_outliers)

    # C2. Sep daily COGS from Inventory Valuation (spot one-off spikes)
    def cogs_daily():
        rows = odoo.rg("account.move.line",
                       [posted, ["date", ">=", "2026-09-01"],
                        ["date", "<=", "2026-10-19"],
                        ["account_id.code", "=", "500101"]],
                       ["balance:sum"], ["date:day"])
        return [{"day": r.get("date:day"),
                 "balance": round(r.get("balance", 0.0)),
                 "lines": r.get("__count")} for r in rows]
    section("C2_cogs_daily", cogs_daily)

    # D. vendor bills: vendor x account (all account types), since Aug 1
    def bills_where():
        rows = odoo.rg("account.move.line",
                       [posted, ["move_id.move_type", "=", "in_invoice"],
                        ["date", ">=", "2026-08-01"],
                        ["display_type", "=", "product"]],
                       ["balance:sum"],
                       ["partner_id", "account_id", "date:month"])
        out = []
        for r in rows:
            out.append({"vendor": name(r.get("partner_id")),
                        "account": name(r.get("account_id")),
                        "month": r.get("date:month"),
                        "balance_iqd": round(r.get("balance", 0.0)),
                        "lines": r.get("__count")})
        return sorted(out, key=lambda x: -abs(x["balance_iqd"]))
    section("D_vendor_bills_by_vendor_account", bills_where)

    # D2. account types for every account that vendor bills touch
    def bill_accounts():
        rows = odoo.rg("account.move.line",
                       [posted, ["move_id.move_type", "=", "in_invoice"],
                        ["date", ">=", "2026-08-01"]],
                       ["balance:sum"], ["account_id"])
        ids = [r["account_id"][0] for r in rows if r.get("account_id")]
        accs = odoo.kw("account.account", "read",
                       [ids, ["code", "name", "account_type"]])
        return [{"code": a.get("code"), "name": name(a.get("name")),
                 "type": a.get("account_type")} for a in accs]
    section("D2_accounts_used_by_bills", bill_accounts)

    # E. Salaries journal by account and month
    def salaries():
        rows = odoo.rg("account.move.line",
                       [posted, ["journal_id.name", "=", "Salaries"],
                        ["date", ">=", "2026-06-01"], ["debit", ">", 0]],
                       ["debit:sum"], ["account_id", "date:month"])
        return [{"account": name(r.get("account_id")),
                 "month": r.get("date:month"),
                 "debit": round(r.get("debit", 0.0)),
                 "lines": r.get("__count")} for r in rows]
    section("E_salaries_journal", salaries)

    # F. rent anywhere
    def rent():
        rows = odoo.kw("account.move.line", "search_read",
                       [[posted, ["date", ">=", "2026-06-01"], "|", "|", "|",
                         ["name", "ilike", "rent"], ["name", "ilike", "ايجار"],
                         ["name", "ilike", "إيجار"], ["ref", "ilike", "ايجار"]]],
                       {"fields": ["date", "account_id", "name", "debit"],
                        "limit": 20})
        return [{"date": r.get("date"), "account": name(r.get("account_id")),
                 "label": r.get("name"), "debit": round(r.get("debit", 0.0))}
                for r in rows]
    section("F_rent_lines", rent)

    print("\n=====DIAG_JSON_BEGIN=====")
    print(json.dumps(REPORT, ensure_ascii=False, indent=2, default=str))
    print("=====DIAG_JSON_END=====")


if __name__ == "__main__":
    sys.exit(main())
