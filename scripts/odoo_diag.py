#!/usr/bin/env python3
"""PulseStock — one-off Odoo accounting diagnostics (READ-ONLY).

Answers the "Real Profit page" due-diligence questions with hard evidence,
straight from Odoo via the same JSON-RPC path as scripts/odoo_sync.py
(same env secrets: ODOO_URL / ODOO_DB / ODOO_USER / ODOO_API_KEY).

Every section is isolated in try/except: a permission or missing-module
error is printed VERBATIM — that error is itself the evidence.

Pure stdlib. Prints one JSON document to stdout (Actions log).
"""

import json
import os
import sys
import time
import urllib.request

RPC_TIMEOUT = 60

REPORT = {}


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


class Odoo:
    """Identical connection pattern to scripts/odoo_sync.py."""

    def __init__(self, env):
        self.url = env["ODOO_URL"].rstrip("/")
        self.db = env["ODOO_DB"]
        self.user = env["ODOO_USER"]
        self.key = env["ODOO_API_KEY"]
        self._id = 0
        self.uid = self._rpc("common", "authenticate",
                             [self.db, self.user, self.key, {}])
        if not isinstance(self.uid, int) or self.uid <= 0:
            raise SystemExit(f"Authentication failed for user {self.user!r}")

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


def section(key, fn):
    """Run fn(), store its result — or the verbatim error — under key."""
    try:
        REPORT[key] = {"ok": True, "data": fn()}
        log(f"  ok: {key}")
    except Exception as e:
        REPORT[key] = {"ok": False, "error": str(e)}
        log(f"  FAIL: {key} -> {e}")


def norm_name(v):
    """Odoo 18 translatable fields may arrive as {'en_US': ...} dicts."""
    if isinstance(v, dict):
        return next(iter(v.values()), "")
    return v


def main():
    env = {k: os.environ.get(k, "") for k in
           ("ODOO_URL", "ODOO_DB", "ODOO_USER", "ODOO_API_KEY")}
    if not all(env.values()):
        raise SystemExit("missing ODOO_* env vars")
    odoo = Odoo(env)
    REPORT["meta"] = {"db": env["ODOO_DB"], "user": env["ODOO_USER"],
                      "run_at": time.strftime("%Y-%m-%d %H:%M:%S UTC",
                                              time.gmtime())}

    # ── Q1: server version ────────────────────────────────────────────────
    section("q1_server_version", lambda: odoo._rpc("common", "version", []))

    # ── Q1: accounting modules installed? ─────────────────────────────────
    def modules():
        rows = odoo.kw("ir.module.module", "search_read",
                       [[["name", "in", ["account", "account_accountant",
                                         "hr_payroll", "stock_landed_costs",
                                         "purchase", "sale_management"]]]],
                       {"fields": ["name", "shortdesc", "state",
                                   "latest_version"]})
        return [{k: r.get(k) for k in
                 ("name", "shortdesc", "state", "latest_version")}
                for r in rows]
    section("q1_modules", modules)

    # ── Q1: is invoicing actually used? posted customer invoices count ─────
    def invoicing_used():
        out = {}
        for mt in ("out_invoice", "in_invoice", "entry", "out_refund"):
            out[mt] = odoo.kw("account.move", "search_count",
                              [[["move_type", "=", mt],
                                ["state", "=", "posted"]]])
        out["invoices_with_payment"] = odoo.kw(
            "account.move", "search_count",
            [[["move_type", "=", "out_invoice"], ["state", "=", "posted"],
              ["payment_state", "in", ["paid", "in_payment"]]]])
        return out
    section("q1_posted_moves_by_type", invoicing_used)

    # ── Q2: expense & revenue accounts ──────────────────────────────────────
    EXP_INC = ["expense", "expense_depreciation", "expense_direct_cost",
               "income", "income_other"]

    def accounts():
        rows = odoo.kw("account.account", "search_read",
                       [[["account_type", "in", EXP_INC],
                         ["deprecated", "=", False]]],
                       {"fields": ["code", "name", "account_type"],
                        "order": "code"})
        return [{"id": r["id"], "code": r.get("code"),
                 "name": norm_name(r.get("name")),
                 "account_type": r.get("account_type")} for r in rows]
    section("q2_accounts", accounts)

    # ── Q2 + Q11: posted journal-item totals per account, two periods ──────
    # THIS read_group on account.move.line with parent_state=posted is also
    # the explicit permission probe requested (Q11). If the sync user lacks
    # accounting rights, the verbatim error lands here.
    def move_line_totals(d_from, d_to):
        rows = odoo.kw("account.move.line", "read_group",
                       [[["parent_state", "=", "posted"],
                         ["date", ">=", d_from], ["date", "<=", d_to],
                         ["account_id.account_type", "in", EXP_INC]],
                        ["debit:sum", "credit:sum", "balance:sum"],
                        ["account_id"]])
        return [{"account": norm_name(r["account_id"][1])
                 if r.get("account_id") else "?",
                 "debit": round(r.get("debit", 0.0)),
                 "credit": round(r.get("credit", 0.0)),
                 "balance": round(r.get("balance", 0.0)),
                 "lines": r.get("account_id_count", r.get("__count"))}
                for r in rows]
    section("q2_q11_sep2026", lambda: move_line_totals("2026-09-01",
                                                       "2026-09-30"))
    section("q2_q11_oct2026_1_19", lambda: move_line_totals("2026-10-01",
                                                            "2026-10-19"))

    # ── Q3: how are expenses recorded? recent vendor bills / misc entries ──
    def recent_moves(mt, limit=40):
        rows = odoo.kw("account.move", "search_read",
                       [[["move_type", "=", mt], ["state", "=", "posted"],
                         ["date", ">=", "2026-08-01"]]],
                       {"fields": ["name", "date", "partner_id", "ref",
                                   "amount_total", "journal_id"],
                        "order": "date desc", "limit": limit})
        return [{"name": r.get("name"), "date": r.get("date"),
                 "partner": norm_name(r["partner_id"][1])
                 if r.get("partner_id") else None,
                 "ref": r.get("ref"), "total": r.get("amount_total"),
                 "journal": norm_name(r["journal_id"][1])
                 if r.get("journal_id") else None} for r in rows]
    section("q3_recent_vendor_bills", lambda: recent_moves("in_invoice"))
    section("q3_recent_misc_entries", lambda: recent_moves("entry", 30))

    # ── Q3: payroll? ────────────────────────────────────────────────────────
    def payroll():
        return {
            "payslips": odoo.kw("hr.payslip", "search_count", [[]]),
            "contracts": odoo.kw("hr.contract", "search_count", [[]]),
            "employees": odoo.kw("hr.employee", "search_count", [[]]),
        }
    section("q3_payroll", payroll)

    # ── Q3/Q6: landed costs (Turkey cargo/customs) ─────────────────────────
    def landed():
        n = odoo.kw("stock.landed.cost", "search_count", [[]])
        rows = odoo.kw("stock.landed.cost", "search_read", [[]],
                       {"fields": ["name", "date", "state", "amount_total"],
                        "order": "date desc", "limit": 10})
        return {"count": n, "recent": rows}
    section("q3_q6_landed_costs", landed)

    # ── Q3: Meta ads expense anywhere in accounting? ───────────────────────
    def meta_ads():
        hits = {}
        rows = odoo.kw("account.move", "search_read",
                       [[["state", "=", "posted"],
                         "|", "|", "|",
                         ["name", "ilike", "meta"],
                         ["ref", "ilike", "meta"],
                         ["name", "ilike", "facebook"],
                         ["ref", "ilike", "facebook"]]],
                       {"fields": ["name", "date", "ref", "amount_total",
                                   "move_type"], "limit": 20})
        hits["moves_meta_facebook"] = rows
        accs = odoo.kw("account.account", "search_read",
                       [[["name", "ilike", "dvertis"]]],  # Advertis../إعلانات
                       {"fields": ["code", "name", "account_type"]})
        hits["ad_accounts"] = [{"code": a.get("code"),
                                "name": norm_name(a.get("name")),
                                "type": a.get("account_type")} for a in accs]
        return hits
    section("q3_meta_ads_in_accounting", meta_ads)

    # ── Q4: COD / courier settlement — journals & payments ─────────────────
    def cod():
        journals = odoo.kw("account.journal", "search_read", [[]],
                           {"fields": ["name", "code", "type"]})
        pays = odoo.kw("account.payment", "search_count",
                       [[["date", ">=", "2026-09-01"]]])
        st_mtd = None
        try:
            st_mtd = odoo.kw("account.bank.statement.line", "search_count",
                             [[["date", ">=", "2026-10-01"]]])
        except Exception as e:
            st_mtd = f"error: {e}"
        return {"journals": [{"name": norm_name(j.get("name")),
                              "code": j.get("code"), "type": j.get("type")}
                             for j in journals],
                "payments_since_sep": pays,
                "bank_statement_lines_since_oct": st_mtd}
    section("q4_journals_payments", cod)

    # ── Q5: inventory costing method per category ──────────────────────────
    def costing():
        rows = odoo.kw("product.category", "read_group",
                       [[],
                        ["property_cost_method"],
                        ["property_cost_method"]])
        detail = odoo.kw("product.category", "search_read", [[]],
                         {"fields": ["name", "property_cost_method",
                                     "property_valuation"]})
        return {"by_method": [
                    {"method": r.get("property_cost_method"),
                     "categories": r.get("property_cost_method_count",
                                         r.get("__count"))} for r in rows],
                "categories": [
                    {"name": norm_name(c.get("name")),
                     "cost_method": c.get("property_cost_method"),
                     "valuation": c.get("property_valuation")}
                    for c in detail]}
    section("q5_costing_method", costing)

    # ── Q7: currencies & rates ─────────────────────────────────────────────
    def currencies():
        comp = odoo.kw("res.company", "search_read", [[]],
                       {"fields": ["name", "currency_id"]})
        cur = odoo.kw("res.currency", "search_read",
                      [[["name", "in", ["IQD", "USD", "TRY"]]]],
                      {"fields": ["name", "symbol", "rate", "rounding"]})
        rates = odoo.kw("res.currency.rate", "search_read",
                        [[["currency_id.name", "in", ["USD", "TRY"]],
                          ["name", ">=", "2026-09-01"]]],
                        {"fields": ["name", "currency_id", "rate"],
                         "order": "name desc", "limit": 12})
        return {"company": [{"name": c.get("name"),
                             "currency": c.get("currency_id")}
                            for c in comp],
                "currencies": cur,
                "recent_usd_try_rates": [
                    {"date": r.get("name"),
                     "currency": r.get("currency_id"),
                     "rate": r.get("rate")} for r in rates]}
    section("q7_currencies", currencies)

    # ── purchase orders: supplier currency (does the shop buy in TRY/USD?) ─
    def purchases():
        rows = odoo.kw("purchase.order", "read_group",
                       [[["state", "in", ["purchase", "done"]],
                         ["date_order", ">=", "2026-07-01"]],
                        ["amount_total:sum"], ["currency_id"]])
        return [{"currency": r.get("currency_id"),
                 "total": round(r.get("amount_total", 0.0)),
                 "orders": r.get("currency_id_count", r.get("__count"))}
                for r in rows]
    section("q7_purchase_currencies", purchases)

    print("\n=====DIAG_JSON_BEGIN=====")
    print(json.dumps(REPORT, ensure_ascii=False, indent=2, default=str))
    print("=====DIAG_JSON_END=====")


if __name__ == "__main__":
    sys.exit(main())
