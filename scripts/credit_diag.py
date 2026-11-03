#!/usr/bin/env python3
"""READ-ONLY: where is a customer's welcome/loyalty credit stored in Odoo?

Prints field and model names plus aggregate counts only — no customer data.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from odoo_diag import Odoo, log  # noqa: E402

PAT = re.compile(r"credit|wallet|loyal|point|balance|رصيد|ولاء|نقاط|ترحيب|vip|gold|tier|فئة|شريحة", re.I)


def safe(fn, default=None):
    try:
        return fn()
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)[:200]} if default is None else default


def main():
    odoo = Odoo(os.environ)
    R = {}

    pf = odoo.kw("res.partner", "fields_get", [],
                 {"attributes": ["string", "type", "relation", "store",
                                 "compute", "related"]})
    R["partner_fields"] = {k: v for k, v in pf.items()
                           if PAT.search(k) or PAT.search(v.get("string") or "")
                           or k.startswith("x_")}

    R["custom_models"] = safe(lambda: odoo.kw(
        "ir.model", "search_read",
        [["|", "|", ["model", "=like", "x_%"], ["state", "=", "manual"],
          ["name", "ilike", "زبائن"]]],
        {"fields": ["model", "name", "modules"], "limit": 200}))
    R["crm_models"] = safe(lambda: odoo.kw(
        "ir.model", "search_read",
        [["|", "|", "|", ["modules", "ilike", "customer"],
          ["modules", "ilike", "crm_"], ["name", "ilike", "علاقات"],
          ["name", "ilike", "حملة"]]],
        {"fields": ["model", "name", "modules"], "limit": 200}))

    R["loyalty_programs"] = safe(lambda: odoo.kw(
        "loyalty.program", "search_read", [[]],
        {"fields": ["name", "program_type", "active", "applies_on",
                    "trigger", "portal_point_name", "date_to"],
         "context": {"active_test": False}, "limit": 100}))
    R["loyalty_cards_by_program"] = safe(lambda: odoo.kw(
        "loyalty.card", "read_group",
        [[["partner_id", "!=", False]], ["points:sum"], ["program_id"]],
        {"lazy": False}))
    R["loyalty_cards_positive"] = safe(lambda: odoo.kw(
        "loyalty.card", "read_group",
        [[["partner_id", "!=", False], ["points", ">", 0]], ["points:sum"],
          ["program_id"]], {"lazy": False}))
    R["loyalty_card_fields"] = safe(lambda: {
        k: v.get("string") for k, v in odoo.kw(
            "loyalty.card", "fields_get", [],
            {"attributes": ["string"]}).items()})

    # Fields on every custom model that look like credit/segment.
    for m in (R["custom_models"] if isinstance(R["custom_models"], list)
              else [])[:40]:
        f = safe(lambda: odoo.kw(m["model"], "fields_get", [],
                                 {"attributes": ["string", "type",
                                                 "relation"]}), {})
        R.setdefault("custom_model_fields", {})[m["model"]] = {
            k: [v.get("string"), v.get("type"), v.get("relation")]
            for k, v in f.items()
            if k.startswith("x_") or PAT.search(k)
            or PAT.search(v.get("string") or "")}
        R.setdefault("custom_model_counts", {})[m["model"]] = safe(
            lambda: odoo.kw(m["model"], "search_count", [[]]), -1)

    R["partner_tags"] = safe(lambda: odoo.kw(
        "res.partner.category", "search_read", [[]],
        {"fields": ["name", "partner_ids"], "limit": 200}))
    if isinstance(R["partner_tags"], list):
        R["partner_tags"] = {t["name"]: len(t["partner_ids"])
                             for t in R["partner_tags"]}

    R2 = {}
    R2["partner_welcome_by_value"] = safe(lambda: [
        (g.get("deniz_crm_welcome_credit"), g["__count"]) for g in odoo.kw(
            "res.partner", "read_group",
            [[["deniz_crm_welcome_credit", ">", 0]], ["id:count"],
             ["deniz_crm_welcome_credit"]], {"lazy": False})])
    R2["card3_by_points"] = safe(lambda: [
        (g.get("points"), g["__count"]) for g in odoo.kw(
            "loyalty.card", "read_group",
            [[["program_id", "=", 3]], ["id:count"], ["points"]],
            {"lazy": False})])
    R2["card3_expiry"] = safe(lambda: [
        (g.get("expiration_date:day"), g["__count"]) for g in odoo.kw(
            "loyalty.card", "read_group",
            [[["program_id", "=", 3]], ["id:count"],
             ["expiration_date:day"]], {"lazy": False})])
    pids = safe(lambda: [c["partner_id"][0] for c in odoo.kw(
        "loyalty.card", "search_read", [[["program_id", "=", 3]]],
        {"fields": ["partner_id"], "limit": 5000})], [])
    R2["card3_partners"] = len(pids)
    R2["card3_partner_field_match"] = safe(lambda: odoo.kw(
        "res.partner", "search_count",
        [[["id", "in", pids], ["deniz_crm_welcome_credit", ">", 0]]]))
    R2["card3_partner_vip_tag"] = safe(lambda: odoo.kw(
        "res.partner", "search_count",
        [[["id", "in", pids], ["category_id.name", "=", "VIP"]]]))
    R2["card3_tier"] = safe(lambda: [
        (g.get("deniz_crm_tier"), g["__count"]) for g in odoo.kw(
            "res.partner", "read_group",
            [[["id", "in", pids]], ["id:count"], ["deniz_crm_tier"]],
            {"lazy": False})])
    R2["wa_accounts"] = safe(lambda: odoo.kw(
        "whatsapp.account", "search_read", [[]],
        {"fields": ["name", "phone_uid", "active"], "limit": 10}))
    R2["wa_templates"] = safe(lambda: odoo.kw(
        "whatsapp.template", "search_read", [[]],
        {"fields": ["name", "template_name", "status", "model",
                    "template_type", "quality"], "limit": 50}))
    R2["wa_var_fields"] = safe(lambda: list(odoo.kw(
        "whatsapp.template.variable", "fields_get", [],
        {"attributes": ["string"]}).keys()))
    R = R2
    print("DIAG_JSON_BEGIN")
    print(json.dumps(R, ensure_ascii=False, indent=1, default=str))
    print("DIAG_JSON_END")


if __name__ == "__main__":
    main()
