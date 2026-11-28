#!/usr/bin/env python3
"""PulseStock — TEMP resale diag 2026-11-28 (READ-ONLY; branch deleted after use).

Same connection and secrets as scripts/odoo_sync.py. Never writes: every RPC
goes through a guard that only allows search_read / fields_get / search_count /
read_group. Prints JSON lines between DIAG_JSON_BEGIN / DIAG_JSON_END.
"""

import json
import os
import sys
import time
import urllib.request

RPC_TIMEOUT = 120
REPORT = {}


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


def section(key, fn):
    try:
        REPORT[key] = {"ok": True, "data": fn()}
        log(f"  ok: {key}")
    except Exception as e:
        REPORT[key] = {"ok": False, "error": str(e)}
        log(f"  FAIL: {key} -> {e}")


SAFE = {"search_read", "fields_get", "search_count", "read_group"}
SHEET = ("https://docs.google.com/spreadsheets/d/1EaE2karm7nAJ5YoNPuBQdWND1t5fSufRlnoyFukZt5g"
         "/export?format=csv&gid=0")


def main():
    env = {k: os.environ.get(k, "") for k in
           ("ODOO_URL", "ODOO_DB", "ODOO_USER", "ODOO_API_KEY")}
    odoo = Odoo(env)
    orig = odoo.kw

    def guarded(model, method, args, kwargs=None):
        if method not in SAFE:
            raise RuntimeError("blocked non-read method " + method)
        return orig(model, method, args, kwargs)
    odoo.kw = guarded
    sr = lambda m, d, f, **k: odoo.kw(m, "search_read", [d], dict(fields=f, **k))

    def sheet():
        import csv, io
        with urllib.request.urlopen(SHEET, timeout=60) as r:
            rows = list(csv.DictReader(io.StringIO(r.read().decode("utf-8"))))
        cols = list(rows[0].keys()) if rows else []
        out = []
        for r in rows:
            out.append([(r.get("id") or "")[:40], (r.get("availability") or "")[:12],
                        (r.get("price") or "")[:14], (r.get("sale_price") or "")[:14],
                        (r.get("custom_label_0") or "")[:20],
                        1 if (r.get("image_link") or "").strip() else 0])
        return {"cols": cols, "n": len(rows), "rows": out}
    section("sheet", sheet)

    def item_fields():
        f = odoo.kw("deniz.clearance.item", "fields_get", [], {"attributes": ["string", "type"]})
        return {k: v.get("string") for k, v in f.items()}
    section("item_fields", item_fields)

    def tmpl_fields():
        f = odoo.kw("product.template", "fields_get", [], {"attributes": ["string", "type"]})
        return {k: v.get("string") for k, v in f.items()
                if k.startswith("deniz") or "clear" in k or "resale" in k}
    section("tmpl_fields", tmpl_fields)

    def oneprice():
        f = odoo.kw("product.template", "fields_get", [], {"attributes": ["type"]})
        if "deniz_oneprice_on" not in f:
            return "no field"
        extra = [k for k in f if k.startswith("deniz_")
                 and f[k]["type"] not in ("binary", "one2many", "many2many", "html")]
        return sr("product.template", [["deniz_oneprice_on", "=", True]],
                  ["default_code", "name"] + extra[:25])
    section("oneprice", oneprice)

    def crons():
        return sr("ir.cron", ["|", ["cron_name", "ilike", "clear"], "|", ["cron_name", "ilike", "resale"],
                  "|", ["cron_name", "ilike", "deniz"], ["cron_name", "ilike", "تصفية"]],
                  ["cron_name", "active", "lastcall", "nextcall", "interval_number", "interval_type"])
    section("crons", crons)

    def logs():
        return sr("ir.logging", [["create_date", ">=", "2026-11-25 00:00:00"],
                  ["level", "in", ["ERROR", "WARNING", "CRITICAL"]]],
                  ["create_date", "name", "level", "func", "message"], limit=40, order="id desc")
    section("ir_logging", logs)

    def step0():
        f = odoo.kw("deniz.clearance.item", "fields_get", [], {"attributes": ["type"]})
        want = [k for k in f if any(s in k for s in ("image", "photo", "sheet", "feed", "meta",
                                                     "publish", "error", "note", "pic"))]
        want = [k for k in want if f[k]["type"] not in ("binary", "one2many", "many2many", "html")]
        rows = sr("deniz.clearance.item",
                  [["state", "in", ["active", "floor", "suggested"]], ["step_no", "=", 0]],
                  ["display_code", "state", "current_price", "base_price"] + want)
        return {"fields": want, "rows": rows}
    section("step0_items", step0)

    print("DIAG_JSON_BEGIN")
    for k, v in REPORT.items():
        if k == "sheet" and v.get("ok"):
            d = v["data"]
            print(json.dumps({"sheet_cols": d["cols"], "n": d["n"]}, ensure_ascii=False))
            for row in d["rows"]:
                print("ROW " + json.dumps(row, ensure_ascii=False))
        else:
            print(json.dumps({k: v}, ensure_ascii=False, default=str))
    print("DIAG_JSON_END")


if __name__ == "__main__":
    main()
