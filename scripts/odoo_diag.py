#!/usr/bin/env python3
"""TEMP read-only diag for the resale morning report (images, purchase flag, crons). Never writes."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from odoo_sync import Odoo, load_env, ENV_PATH  # noqa

o = Odoo(load_env(ENV_PATH))
R = {}
def q(name, fn):
    try:
        R[name] = fn()
    except Exception as e:
        R[name] = {"error": str(e)[:400]}

OPEN = ["active", "due", "floor"]
q("items", lambda: o.kw("deniz.clearance.item", "search_read", [[["state", "in", OPEN + ["suggested"]]]],
    {"fields": ["display_code", "state", "step_no", "qty", "model_idle_days", "current_price", "base_price",
                "cdn_url", "cdn_pending", "cdn_error", "cdn_file_id", "feed_code"]}))
q("with_image", lambda: o.kw("deniz.clearance.item", "search_read",
    [[["state", "in", OPEN], ["image", "!=", False]]], {"fields": ["id"]}))
q("oneprice_off", lambda: o.kw("product.template", "search_read",
    [[["deniz_oneprice_on", "=", True]]], {"fields": ["name", "default_code"], "context": {"active_test": False}}))
q("oneprice_fields", lambda: o.kw("product.template", "fields_get", [], {"attributes": ["string", "type"]}))
q("crons", lambda: o.kw("ir.cron", "search_read",
    [[["cron_name", "ilike", "clear"]]], {"fields": ["cron_name", "active", "lastcall", "nextcall", "failure_count", "first_failure_date"], "context": {"active_test": False}}))
q("crons2", lambda: o.kw("ir.cron", "search_read",
    [["|", "|", ["cron_name", "ilike", "بيع"], ["cron_name", "ilike", "تصفية"], ["cron_name", "ilike", "resale"]]], {"fields": ["cron_name", "active", "lastcall", "nextcall"], "context": {"active_test": False}}))
f = R.get("oneprice_fields")
if isinstance(f, dict) and "error" not in f:
    R["oneprice_fields"] = {k: v for k, v in f.items() if "oneprice" in k or "resale" in k or "purchase_off" in k or "hold" in k}
print("DIAG_JSON_BEGIN")
print(json.dumps(R, ensure_ascii=False, default=str))
print("DIAG_JSON_END")
