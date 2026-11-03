#!/usr/bin/env python3
"""PulseStock — returning-customer diagnostics (READ-ONLY, aggregates only).

Answers: how many orders come from customers who bought before, how many
dormant customers came back each month, and how fast new customers repeat.

A customer = normalized phone (last 10 digits of phone/mobile), falling back
to the commercial partner id, so duplicate contacts for the same woman count
once. No phone, name or id is ever printed — only counts.

Same connection and secrets as scripts/odoo_sync.py. Never writes.
Prints one JSON document between DIAG_JSON_BEGIN / DIAG_JSON_END.
"""

import collections
import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from odoo_diag import Odoo, log, name  # noqa: E402

BAGHDAD = datetime.timezone(datetime.timedelta(hours=3))
DORMANT_DAYS = 90


def local_day(s):
    if not s:
        return None
    dt = datetime.datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")
    return dt.replace(tzinfo=datetime.timezone.utc).astimezone(BAGHDAD).date()


def gap_bucket(g):
    if g is None:
        return "new"
    if g < 30:
        return "lt30"
    if g < 90:
        return "30_89"
    if g < 180:
        return "90_179"
    if g < 365:
        return "180_364"
    return "365plus"


def main():
    odoo = Odoo(os.environ)
    today = datetime.datetime.now(BAGHDAD).date()

    so_f = odoo.kw("sale.order", "fields_get", [], {"attributes": ["type"]})
    o_fields = ["partner_id", "create_date"]
    if "source_id" in so_f:
        o_fields.append("source_id")

    log("fetching all confirmed orders…")
    orders, offset = [], 0
    while True:
        batch = odoo.kw("sale.order", "search_read",
                        [[["state", "in", ["sale", "done"]]]],
                        {"fields": o_fields, "limit": 20000,
                         "offset": offset, "order": "id asc"})
        orders.extend(batch)
        if len(batch) < 20000:
            break
        offset += 20000
    log(f"  {len(orders)} orders")

    p_f = odoo.kw("res.partner", "fields_get", [], {"attributes": ["type"]})
    phone_fields = [f for f in ("phone", "mobile") if f in p_f]
    pids = sorted({o["partner_id"][0] for o in orders if o.get("partner_id")})
    log(f"reading {len(pids)} partners…")
    key_of = {}
    for i in range(0, len(pids), 2000):
        for p in odoo.kw("res.partner", "read",
                         [pids[i:i + 2000],
                          phone_fields + ["commercial_partner_id"]]):
            ph = ""
            for f in phone_fields:
                d = re.sub(r"\D", "", p.get(f) or "")
                if len(d) >= 10:
                    ph = d[-10:]
                    break
            cp = p.get("commercial_partner_id")
            key_of[p["id"]] = ("t" + ph) if ph else \
                ("p" + str(cp[0] if cp else p["id"]))

    # Order events per customer, chronological.
    ev = collections.defaultdict(list)
    for o in orders:
        if not o.get("partner_id"):
            continue
        d = local_day(o.get("create_date"))
        if d:
            ev[key_of[o["partner_id"][0]]].append(
                (d, name(o.get("source_id")) or "—"))
    for k in ev:
        ev[k].sort()

    month = lambda d: d.strftime("%Y-%m")  # noqa: E731
    m_from = (today.replace(day=1) - datetime.timedelta(days=365)) \
        .replace(day=1)
    by_month = collections.defaultdict(lambda: collections.Counter())
    by_week = collections.defaultdict(lambda: collections.Counter())
    src_ret = collections.Counter()
    src_all = collections.Counter()
    reactivated_cust = collections.defaultdict(set)
    first_month = {}
    w_from = today - datetime.timedelta(days=7 * 8)
    src_from = today - datetime.timedelta(days=60)

    for k, evs in ev.items():
        first_month[k] = evs[0][0]
        prev = None
        for d, src in evs:
            g = None if prev is None else (d - prev).days
            if g == 0:            # second order same day = same visit
                continue
            b = gap_bucket(g)
            if d >= m_from:
                c = by_month[month(d)]
                c["orders"] += 1
                c[b] += 1
                if b in ("90_179", "180_364", "365plus"):
                    reactivated_cust[month(d)].add(k)
            if d >= w_from:
                wk = (d - datetime.timedelta(
                    days=(d.weekday() - 5) % 7)).isoformat()
                by_week[wk]["orders"] += 1
                by_week[wk][b] += 1
            if d >= src_from:
                src_all[src] += 1
                if b != "new":
                    src_ret[src] += 1
            prev = d

    # Dormant pool at the start of each month and the share that came back.
    months = sorted(by_month)
    pool = {}
    for m in months:
        start = datetime.date.fromisoformat(m + "-01")
        n = 0
        for evs in ev.values():
            last = None
            for d, _ in evs:
                if d < start:
                    last = d
                else:
                    break
            if last and (start - last).days >= DORMANT_DAYS:
                n += 1
        pool[m] = n

    # Repeat rate of each first-purchase cohort within 90 days.
    cohort = collections.defaultdict(lambda: [0, 0])
    for k, evs in ev.items():
        f = evs[0][0]
        if f < m_from or (today - f).days < 90:
            continue
        cohort[month(f)][0] += 1
        if any(0 < (d - f).days <= 90 for d, _ in evs[1:]):
            cohort[month(f)][1] += 1

    last_order = [evs[-1][0] for evs in ev.values()]
    REPORT = {
        "asOf": today.isoformat(),
        "customers_total": len(ev),
        "customers_with_phone_key": sum(1 for k in ev if k[0] == "t"),
        "partners_total": len(pids),
        "buyers_2plus_orders": sum(
            1 for evs in ev.values() if len({d for d, _ in evs}) >= 2),
        "last_order_age": {
            "lt90": sum(1 for d in last_order if (today - d).days < 90),
            "90_179": sum(1 for d in last_order
                          if 90 <= (today - d).days < 180),
            "180_364": sum(1 for d in last_order
                           if 180 <= (today - d).days < 365),
            "365plus": sum(1 for d in last_order
                           if (today - d).days >= 365),
        },
        "by_month": {m: dict(by_month[m], dormant_pool=pool[m],
                             reactivated_customers=len(reactivated_cust[m]))
                     for m in months},
        "by_week_sat": {w: dict(c) for w, c in sorted(by_week.items())},
        "source_60d": {s: {"orders": src_all[s], "returning": src_ret[s]}
                       for s, _ in src_all.most_common(15)},
        "cohort_repeat90": {m: {"new": c[0], "repeat90": c[1]}
                            for m, c in sorted(cohort.items())},
    }
    print("DIAG_JSON_BEGIN")
    print(json.dumps(REPORT, ensure_ascii=False, indent=1))
    print("DIAG_JSON_END")


if __name__ == "__main__":
    main()
