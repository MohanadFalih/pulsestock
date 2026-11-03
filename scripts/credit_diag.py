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

    print("DIAG_JSON_BEGIN")
    print(json.dumps(R, ensure_ascii=False, indent=1, default=str))
    print("DIAG_JSON_END")


if __name__ == "__main__":
    main()
