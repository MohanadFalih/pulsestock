#!/usr/bin/env python3
"""READ-ONLY: what rule set the VIP welcome credit? Aggregates only."""
import collections, json, os, statistics, sys
sys.path.insert(0, os.path.dirname(__file__))
from odoo_diag import Odoo  # noqa: E402

def main():
    o = Odoo(os.environ)
    cards = o.kw("loyalty.card", "search_read", [[["program_id", "=", 3]]],
                 {"fields": ["partner_id", "points", "create_date"], "limit": 5000})
    pf = ["x_dm_hist_orders", "x_dm_hist_spend", "x_dm_hist_last",
          "deniz_crm_welcome_credit", "category_id"]
    pid = sorted({c["partner_id"][0] for c in cards if c.get("partner_id")})
    vip = o.kw("res.partner", "search", [[["category_id.name", "=", "VIP"]]])
    allp = sorted(set(pid) | set(vip))
    P = {}
    for i in range(0, len(allp), 1000):
        for p in o.kw("res.partner", "read", [allp[i:i+1000], pf]):
            P[p["id"]] = p
    by = collections.defaultdict(list)
    for c in cards:
        if c.get("partner_id"):
            by[c["points"]].append(P.get(c["partner_id"][0], {}))
    def summ(ps):
        sp = [p.get("x_dm_hist_spend") or 0 for p in ps]
        od = [p.get("x_dm_hist_orders") or 0 for p in ps]
        q = lambda a: [round(x) for x in statistics.quantiles(a, n=4)] if len(a) > 3 else a
        return {"n": len(ps), "spend_min": min(sp) if sp else 0, "spend_q": q(sp),
                "spend_max": max(sp) if sp else 0, "orders_q": q(od),
                "orders_min": min(od) if od else 0, "orders_max": max(od) if od else 0,
                "ratio_q": q([c / s * 100 for c, s in zip([0]*0, [])]) }
    R = {"cards": len(cards), "card_created_days": sorted(collections.Counter(
        (c.get("create_date") or "")[:10] for c in cards).items()),
         "by_points": {str(k): summ(v) for k, v in sorted(by.items())}}
    # credit / spend ratio per card
    rat = [c["points"] / (P[c["partner_id"][0]].get("x_dm_hist_spend") or 1) * 100
           for c in cards if c.get("partner_id") and P.get(c["partner_id"][0], {}).get("x_dm_hist_spend")]
    R["credit_pct_of_spend_q"] = [round(x, 2) for x in statistics.quantiles(rat, n=10)] if rat else []
    nocard = [P[i] for i in vip if i not in set(pid)]
    R["vip_without_card"] = summ(nocard)
    R["vip_with_card"] = summ([P[i] for i in vip if i in set(pid)])
    print("DIAG_JSON_BEGIN"); print(json.dumps(R, ensure_ascii=False, default=str)); print("DIAG_JSON_END")

if __name__ == "__main__":
    main()
