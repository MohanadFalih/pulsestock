#!/usr/bin/env python3
"""TEMP (branch only): resale morning-report diagnostics. READ-ONLY."""
import csv, io, json, os, sys, urllib.request

RPC_TIMEOUT = 120
SHEET_CSV = ("https://docs.google.com/spreadsheets/d/1EaE2karm7nAJ5YoNPuBQdWND1t5fSufRlnoyFukZt5g"
             "/export?format=csv&gid=0")


class Odoo:
    def __init__(self, env):
        self.url = env["ODOO_URL"].rstrip("/")
        self.db = env["ODOO_DB"]
        self.key = env["ODOO_API_KEY"]
        self._id = 0
        self.uid = self._rpc("common", "authenticate", [self.db, env["ODOO_USER"], self.key, {}])

    def _rpc(self, service, method, args):
        self._id += 1
        payload = {"jsonrpc": "2.0", "method": "call", "id": self._id,
                   "params": {"service": service, "method": method, "args": args}}
        req = urllib.request.Request(self.url + "/jsonrpc", data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=RPC_TIMEOUT) as r:
            res = json.load(r)
        if "error" in res:
            raise RuntimeError(res["error"].get("data", {}).get("message", res["error"]))
        return res["result"]

    def kw(self, model, method, args, kwargs=None):
        return self._rpc("object", "execute_kw", [self.db, self.uid, self.key, model, method, args, kwargs or {}])


def safe(fn):
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)[:300]}


def main():
    o = Odoo(os.environ)
    out = {}
    open_states = ["suggested", "active", "due", "floor", "paused"]
    fields = ["display_code", "product_tmpl_id", "state", "step_no", "current_price", "base_price",
              "cost_price", "qty", "cdn_url", "cdn_pending", "cdn_error", "feed_code", "announced_on",
              "stage_start", "cost_issue"]
    items = o.kw("deniz.clearance.item", "search_read", [[["state", "in", open_states]]], {"fields": fields})
    with_img = set(o.kw("deniz.clearance.item", "search", [[["state", "in", open_states], ["image", "!=", False]]]))
    out["items"] = [[i["id"], i["display_code"], (i["product_tmpl_id"] or [0, ""])[1], i["state"], i["step_no"],
                     i["current_price"], i["base_price"], i["qty"], bool(i["cdn_url"]), i["cdn_pending"],
                     i["cdn_error"] or "", i["feed_code"] or "", i["id"] in with_img, i["stage_start"] or ""]
                    for i in items]
    out["oneprice"] = safe(lambda: [[t["id"], t["display_name"], t["purchase_ok"], t["deniz_oneprice_purchase_was"]]
                                    for t in o.kw("product.template", "search_read",
                                                  [[["deniz_oneprice_on", "=", True]]],
                                                  {"fields": ["display_name", "purchase_ok", "deniz_oneprice_purchase_was"],
                                                   "context": {"active_test": False}})])

    def channel():
        p = o.kw("ir.config_parameter", "get_param", ["deniz_clearance.channel_id"])
        msgs = o.kw("mail.message", "search_read", [[["model", "=", "discuss.channel"], ["res_id", "=", int(p)]]],
                    {"fields": ["date", "body"], "limit": 6, "order": "id desc"})
        return [[m["date"], m["body"][:2500]] for m in msgs]
    out["channel"] = safe(channel)
    out["crons"] = safe(lambda: [[c["cron_name"], c["active"], c["lastcall"], c["nextcall"]] for c in
                                 o.kw("ir.cron", "search_read", [["|", ["cron_name", "ilike", "clearance"],
                                                                   "|", ["cron_name", "ilike", "إعادة"],
                                                                   ["cron_name", "ilike", "تصفية"]]],
                                      {"fields": ["cron_name", "active", "lastcall", "nextcall"],
                                       "context": {"active_test": False}})])

    def sheet():
        with urllib.request.urlopen(SHEET_CSV, timeout=60) as r:
            rows = list(csv.DictReader(io.StringIO(r.read().decode("utf-8"))))
        cols = list(rows[0].keys()) if rows else []
        return {"cols": cols, "rows": [[r.get("id", ""), r.get("availability", ""), r.get("price", ""),
                                        r.get("sale_price", ""), r.get("custom_label_0", ""),
                                        bool((r.get("image_link") or "").strip())] for r in rows if r.get("id")]}
    out["sheet"] = safe(sheet)
    print("DIAG_JSON_BEGIN")
    print(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print("DIAG_JSON_END")
    return 0


if __name__ == "__main__":
    sys.exit(main())
