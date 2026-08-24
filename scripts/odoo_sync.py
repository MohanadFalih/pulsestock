#!/usr/bin/env python3
"""PulseStock Stage 2 — live Odoo sync connector.

Pulls the active product lifecycle set from a real Odoo 18 Enterprise via the
JSON-RPC external API and writes `public/data/live.json` for the frontend.

Pure Python 3 stdlib (urllib/json/os/datetime) — no pip packages.

Data selection
--------------
ACTIVE-LIFECYCLE product templates = union of
  A) create_date >= today - 120 days  (recently created), and
  B) templates with sale.order.line rows in confirmed orders
     (state in sale/done) created within the last 90 days,
EXCLUDING pseudo-products: delivery.carrier products, loyalty discount
products, and manual-discount lines (PSEUDO_NAMES). Safety cap 400.

All day bucketing uses the shop local timezone (Iraq, UTC+3, no DST) so
daily numbers match what the owner sees in the Odoo UI.

Per-template metrics (aggregated across its product.product variants)
---------------------------------------------------------------------
  odooCreatedDate         product.template.create_date (local date)
  unitPrice               list_price
  category                categ_id display name
  orders                  distinct confirmed sale.order documents containing
                          the product (matches how the owner counts orders)
  units                   sum product_uom_qty on those confirmed lines
  revenue                 sum price_total — product revenue only; delivery
                          and discount lines leave with their products
  firstOrderDate/lastOrderDate  min/max sale.order.line create_date (local)
                          (line creation == order placement in this shop)
  delivered               sum product_uom_qty of done stock.move on outgoing
                          pickings (picking_id.picking_type_code = 'outgoing')
  returned                sum product_uom_qty of done stock.move with
                          origin_returned_move_id set (customer returns)
  unitsBoughtFromSupplier sum product_qty of purchase.order.line
                          (order state in purchase/done)
  returnedStock           sum qty_available over the template's variants
                          (warehouse stock here is almost entirely returns)
  orderVelocity7d         distinct order documents in the last 7 days / 7
  daysSinceLastOrder      whole days since lastOrderDate (null if none)

Daily time series (live.json "daily" block, last 90 local days, sparse)
-----------------------------------------------------------------------
  byProduct  odooId -> {day: [orderDocs, units, revenue]}
  moves      day -> [deliveredUnits, returnedUnits]   (portfolio level)
  orders     day -> distinct confirmed order documents across the whole shop
             (read from sale.order directly — matches the Odoo orders list)

Note: sale.order.line has no product_tmpl_id field on this install, so every
read_group groups by product_id and results are rolled up to templates via a
variant->template map built once.

Stage inference (connector owns `stage`; the frontend owns rates/alerts)
------------------------------------------------------------------------
  orders == 0                                   -> 'created'
  orders > 0, returnedStock == 0,
      daysSinceLastOrder >= 14                  -> 'completed'
  orders > 0, returnedStock > 0,
      daysSinceLastOrder >= 7,
      orderVelocity7d == 0                      -> 'selling-returns'
  orders > 0, delivered < 10                    -> 'ads-live'
  otherwise                                     -> 'selling'
'shared' needs butiksistem data; 'supplier-low' / 'organic-only' need supplier
stock levels we don't have yet — never inferred here.

Ownership split: the connector ships RAW metrics (+ stage) in live.json; the
frontend decision engine (src/data) computes returnRate, returnConfidence,
alerts and scale readiness from those raw fields.
"""

import datetime
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ENV_PATH = os.path.join(ROOT, ".env")
OUT_PATH = os.path.join(ROOT, "public", "data", "live.json")

RECENT_CREATE_DAYS = 120   # selection window A
RECENT_ORDER_DAYS = 90     # selection window B (covers the whole daily series)
MAX_PRODUCTS = 400         # safety cap only — the full active set is ~320
VELOCITY_DAYS = 7
DAILY_DAYS = 90            # daily time-series depth for window selectors
RPC_TIMEOUT = 60
# All dates/days are bucketed in the shop's local timezone (Iraq = UTC+3,
# no DST) so dashboard days match what the user sees in the Odoo UI.
LOCAL_TZ = datetime.timezone(datetime.timedelta(hours=3), "Asia/Baghdad")
# Pseudo-products never tracked as sellable products (exact names).
PSEUDO_NAMES = {"خصم"}     # manual discount lines; delivery handled via carrier


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def load_env(path):
    # GitHub Actions (or any CI) provides credentials as environment variables;
    # locally we fall back to the .env file next to the repo root.
    ci_keys = ("ODOO_URL", "ODOO_DB", "ODOO_USER", "ODOO_API_KEY")
    if all(os.environ.get(k) for k in ci_keys):
        log("credentials: environment variables (CI mode)")
        return {k: os.environ[k] for k in ci_keys}
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


class Odoo:
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
        log(f"authenticated as uid={self.uid}")

    def _rpc(self, service, method, args):
        self._id += 1
        payload = {"jsonrpc": "2.0", "method": "call", "id": self._id,
                   "params": {"service": service, "method": method, "args": args}}
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

    def read_group(self, model, domain, fields, groupby):
        rows = self.kw(model, "read_group", [domain, fields, groupby])
        # Odoo <17 compatibility: aggregates may arrive under plain names.
        return rows


def now_local():
    return datetime.datetime.now(LOCAL_TZ)


def days_ago(n):
    return (now_local().date() - datetime.timedelta(days=n)).isoformat()


def local_day(s):
    """Odoo naive UTC datetime string -> local (Iraq) ISO day string."""
    if not s:
        return None
    dt = datetime.datetime.fromisoformat(s.replace(" ", "T", 1))
    dt = dt.replace(tzinfo=datetime.timezone.utc).astimezone(LOCAL_TZ)
    return dt.date().isoformat()


def parse_dt(s):
    """Odoo naive UTC datetime string -> local date."""
    d = local_day(s)
    return datetime.date.fromisoformat(d) if d else None


def main():
    t0 = time.time()
    env = load_env(ENV_PATH)
    currency = env.get("ODOO_CURRENCY", "IQD")
    odoo = Odoo(env)
    today = now_local().date()

    # ── 0. Identify pseudo-products to exclude ──────────────────────────────
    # Delivery-fee products are linked from delivery.carrier; discount lines
    # come from loyalty rewards; plus exact-name manual discounts.
    pseudo_variant_ids = set()
    try:
        for c in odoo.kw("delivery.carrier", "search_read", [[]],
                         {"fields": ["product_id"]}):
            if c.get("product_id"):
                pseudo_variant_ids.add(c["product_id"][0])
    except Exception as e:
        log(f"  warning: delivery.carrier lookup failed ({e})")
    try:
        for r in odoo.kw("loyalty.reward", "search_read", [[]],
                         {"fields": ["discount_line_product_id"]}):
            if r.get("discount_line_product_id"):
                pseudo_variant_ids.add(r["discount_line_product_id"][0])
    except Exception as e:
        log(f"  warning: loyalty.reward lookup failed ({e})")
    pseudo_tmpl_ids = set()
    if pseudo_variant_ids:
        for i in range(0, len(pseudo_variant_ids), 200):
            chunk = list(pseudo_variant_ids)[i:i + 200]
            for v in odoo.kw("product.product", "read",
                             [chunk, ["product_tmpl_id"]]):
                pseudo_tmpl_ids.add(v["product_tmpl_id"][0])
    log(f"  pseudo-product templates excluded: {len(pseudo_tmpl_ids)}")

    # ── 1. Select active-lifecycle templates ────────────────────────────────
    log("selecting active templates…")
    recent_ids = odoo.kw(
        "product.template", "search",
        [[["sale_ok", "=", True],
          ["create_date", ">=", days_ago(RECENT_CREATE_DAYS)]]])
    log(f"  window A (created ≤{RECENT_CREATE_DAYS}d): {len(recent_ids)} templates")

    # Window B: products with confirmed order lines in the last 90 days.
    recent_lines = odoo.read_group(
        "sale.order.line",
        [("order_id.state", "in", ["sale", "done"]),
         ("create_date", ">=", days_ago(RECENT_ORDER_DAYS))],
        ["product_uom_qty:sum"], ["product_id"])
    recent_product_ids = [r["product_id"][0] for r in recent_lines if r.get("product_id")]
    log(f"  window B (ordered ≤{RECENT_ORDER_DAYS}d): {len(recent_product_ids)} variants")
    ordered_tmpl_ids = set()
    for i in range(0, len(recent_product_ids), 200):
        chunk = recent_product_ids[i:i + 200]
        for v in odoo.kw("product.product", "read", [chunk, ["product_tmpl_id"]]):
            ordered_tmpl_ids.add(v["product_tmpl_id"][0])
    log(f"  window B maps to {len(ordered_tmpl_ids)} templates")

    candidate_ids = sorted((set(recent_ids) | ordered_tmpl_ids) - pseudo_tmpl_ids)
    cands = odoo.kw(
        "product.template", "search_read", [[["id", "in", candidate_ids]]],
        {"fields": ["name", "create_date", "list_price", "categ_id"],
         "order": "create_date desc"})
    # Exact-name pseudo exclusions (e.g. manual discount lines) + safety cap.
    templates = [t for t in cands
                 if (t["name"] or "").strip() not in PSEUDO_NAMES][:MAX_PRODUCTS]
    tmpl_ids = [t["id"] for t in templates]
    log(f"  selected {len(templates)} templates "
        f"(excluded {len(cands) - len(templates)} pseudo by name; cap {MAX_PRODUCTS})")

    # ── 2. Variant map + on-hand stock ──────────────────────────────────────
    log("loading variants + on-hand stock…")
    variants = []
    offset = 0
    while True:
        batch = odoo.kw(
            "product.product", "search_read",
            [[["product_tmpl_id", "in", tmpl_ids]]],
            {"fields": ["product_tmpl_id", "qty_available"],
             "limit": 2000, "offset": offset})
        variants.extend(batch)
        if len(batch) < 2000:
            break
        offset += 2000
    tmpl_of_variant = {}
    stock_by_tmpl = {}
    for v in variants:
        tid = v["product_tmpl_id"][0]
        tmpl_of_variant[v["id"]] = tid
        stock_by_tmpl[tid] = stock_by_tmpl.get(tid, 0.0) + (v.get("qty_available") or 0.0)
    log(f"  {len(variants)} variants across {len(tmpl_ids)} templates")

    def rollup(rows, key_field, value_field):
        """read_group rows grouped by product_id -> {template_id: sum}."""
        out = {}
        for r in rows:
            pid = r.get("product_id")
            if not pid:
                continue
            tid = tmpl_of_variant.get(pid[0])
            if tid is None:
                continue
            out[tid] = out.get(tid, 0.0) + (r.get(value_field) or 0.0)
        return out

    in_active = ("product_id.product_tmpl_id", "in", tmpl_ids)
    confirmed = ("order_id.state", "in", ["sale", "done"])

    # ── 3. Sales aggregates (batched read_group) ────────────────────────────
    log("aggregating sale.order.line (units + revenue)…")
    sol_rows = odoo.read_group(
        "sale.order.line", [confirmed, in_active],
        ["product_uom_qty:sum", "price_total:sum"], ["product_id"])
    units_by_tmpl = rollup(sol_rows, "product_id", "product_uom_qty")
    revenue_by_tmpl = rollup(sol_rows, "product_id", "price_total")
    n_lines = sum(r.get("product_id_count", 0) for r in sol_rows)
    log(f"  {n_lines} confirmed order lines")

    # First/last order dates: read_group date min/max aggregates return None on
    # this install, so walk the actual lines (same domain). The same walk
    # collects distinct order documents (lifetime + per local day), daily
    # units/revenue buckets, and the 7-day velocity — no extra RPC calls.
    log("scanning order lines (dates, distinct orders, daily buckets)…")
    first_order, last_order = {}, {}
    docs_by_tmpl = {}         # tid -> set(order_id)  (lifetime distinct docs)
    daily_sales = {}          # tid -> {"YYYY-MM-DD": [docsSet, units, revenue]}
    daily_from = (today - datetime.timedelta(days=DAILY_DAYS)).isoformat()
    for i in range(0, len(tmpl_ids), 40):
        chunk = tmpl_ids[i:i + 40]
        lines = odoo.kw(
            "sale.order.line", "search_read",
            [[confirmed, ("product_id.product_tmpl_id", "in", chunk)]],
            {"fields": ["product_id", "create_date", "order_id",
                        "product_uom_qty", "price_total"],
             "limit": 10000})
        for ln in lines:
            tid = tmpl_of_variant.get(ln["product_id"][0])
            if tid is None:
                continue
            d = ln.get("create_date")
            if not d:
                continue
            if tid not in first_order or d < first_order[tid]:
                first_order[tid] = d
            if tid not in last_order or d > last_order[tid]:
                last_order[tid] = d
            oid = ln["order_id"][0] if ln.get("order_id") else None
            if oid is not None:
                docs_by_tmpl.setdefault(tid, set()).add(oid)
            day = local_day(d)
            if day and day >= daily_from:
                bucket = daily_sales.setdefault(tid, {})
                cell = bucket.setdefault(day, [set(), 0.0, 0.0])
                if oid is not None:
                    cell[0].add(oid)
                cell[1] += ln.get("product_uom_qty") or 0.0
                cell[2] += ln.get("price_total") or 0.0
    log(f"  dated {len(first_order)} templates with orders; "
        f"daily buckets for {len(daily_sales)} templates")

    # ── 4. Portfolio daily order documents (exact Odoo parity) ──────────────
    # Distinct confirmed sale.order documents per local day across the WHOLE
    # shop — this is the number the owner compares against the Odoo orders
    # list, independent of product tracking.
    log("counting shop-wide order documents per day…")
    daily_orders = {}         # "YYYY-MM-DD" -> distinct doc count
    shop_orders = odoo.kw(
        "sale.order", "search_read",
        [[["state", "in", ["sale", "done"]],
          ["create_date", ">=", days_ago(DAILY_DAYS + 1)]]],
        {"fields": ["create_date"], "limit": 20000})
    for o in shop_orders:
        day = local_day(o.get("create_date"))
        if day:
            daily_orders[day] = daily_orders.get(day, 0) + 1
    log(f"  {len(shop_orders)} confirmed documents across "
        f"{len(daily_orders)} days")

    # 7-day velocity from the daily buckets (distinct docs, local days).
    vel_from = (today - datetime.timedelta(days=VELOCITY_DAYS - 1)).isoformat()
    vel7_by_tmpl = {
        tid: sum(len(cell[0]) for day, cell in days.items() if day >= vel_from)
        for tid, days in daily_sales.items()
    }

    # ── 5. Delivered / returned units from stock.move ───────────────────────
    log("aggregating stock.move (delivered + returned)…")
    out_rows = odoo.read_group(
        "stock.move",
        [("picking_id.picking_type_code", "=", "outgoing"),
         ("state", "=", "done"), in_active],
        ["product_uom_qty:sum"], ["product_id"])
    delivered_by_tmpl = rollup(out_rows, "product_id", "product_uom_qty")

    ret_rows = odoo.read_group(
        "stock.move",
        [("origin_returned_move_id", "!=", False),
         ("state", "=", "done"), in_active],
        ["product_uom_qty:sum"], ["product_id"])
    returned_by_tmpl = rollup(ret_rows, "product_id", "product_uom_qty")

    # Daily delivered/returned (portfolio level) for the chart window. Walk
    # done moves from the last DAILY_DAYS and bucket by local (Iraq) date.
    log("scanning stock.move for daily delivered/returned…")
    daily_moves = {}          # "YYYY-MM-DD" -> [delivered, returned]
    for domain in (
        [("picking_id.picking_type_code", "=", "outgoing"),
         ("state", "=", "done"), in_active,
         ("date", ">=", days_ago(DAILY_DAYS + 1))],
        [("origin_returned_move_id", "!=", False),
         ("state", "=", "done"), in_active,
         ("date", ">=", days_ago(DAILY_DAYS + 1))],
    ):
        is_return = domain[0][0] == "origin_returned_move_id"
        moves = odoo.kw(
            "stock.move", "search_read", [domain],
            {"fields": ["date", "product_uom_qty"], "limit": 20000})
        for mv in moves:
            day = local_day(mv.get("date"))
            if not day:
                continue
            cell = daily_moves.setdefault(day, [0.0, 0.0])
            cell[1 if is_return else 0] += mv.get("product_uom_qty") or 0.0
    log(f"  daily moves bucketed across {len(daily_moves)} days")

    # ── 6. Supplier purchases ───────────────────────────────────────────────
    log("aggregating purchase.order.line (bought from supplier)…")
    pol_rows = odoo.read_group(
        "purchase.order.line",
        [("order_id.state", "in", ["purchase", "done"]), in_active],
        ["product_qty:sum"], ["product_id"])
    bought_by_tmpl = rollup(pol_rows, "product_id", "product_qty")

    # ── 6b. Shop-wide warehouse stock (everything on hand, not just tracked) ─
    # Mirrors Odoo's Inventory → Reporting → Stock report (filter "Available
    # Products") so the card matches what the owner sees in the Odoo UI:
    #   units = sum(product.product.qty_available) over variants with qty > 0
    #   value = Σ qty_available × standard_price   (COST, not list price)
    # qty_available semantics automatically exclude supplier-side stock at
    # Partners/Vendors/* locations (e.g. goods still in Turkey) — verified
    # 2026-08-22: 1,735 variants / 2,197 units / ≈67.16M IQD == Odoo report.
    log("aggregating shop-wide on-hand stock (product.product.qty_available)…")
    avail_ids = odoo.kw("product.product", "search",
                        [[["qty_available", ">", 0]]])
    shop_units = 0.0
    shop_value = 0.0
    shop_products = 0
    for i in range(0, len(avail_ids), 200):
        for v in odoo.kw("product.product", "read",
                         [avail_ids[i:i + 200],
                          ["qty_available", "standard_price"]]):
            qty = v.get("qty_available") or 0.0
            if qty <= 0:
                continue
            shop_units += qty
            shop_products += 1
            shop_value += qty * (v.get("standard_price") or 0.0)
    log(f"  shop stock: {shop_units:.0f} units across {shop_products} variants, "
        f"≈{shop_value:,.0f} {currency} (valued at cost)")

    # ── 7. Assemble records ─────────────────────────────────────────────────
    log("assembling live.json records…")
    products = []
    for t in templates:
        tid = t["id"]
        orders = len(docs_by_tmpl.get(tid, ()))      # distinct order documents
        units = units_by_tmpl.get(tid, 0.0)
        delivered = delivered_by_tmpl.get(tid, 0.0)
        returned = returned_by_tmpl.get(tid, 0.0)
        returned_stock = stock_by_tmpl.get(tid, 0.0)
        vel7 = vel7_by_tmpl.get(tid, 0) / VELOCITY_DAYS
        last_d = parse_dt(last_order.get(tid))
        days_since = (today - last_d).days if last_d else None

        # Stage inference (documented in the module docstring).
        if orders <= 0:
            stage = "created"
        elif returned_stock == 0 and days_since is not None and days_since >= 14:
            stage = "completed"
        elif (returned_stock > 0 and days_since is not None
              and days_since >= 7 and vel7 == 0):
            stage = "selling-returns"
        elif delivered < 10:
            stage = "ads-live"
        else:
            stage = "selling"

        products.append({
            "odooId": tid,
            "name": t["name"],
            "sku": t["name"],               # products are named by SKU code
            "category": t["categ_id"][1] if t.get("categ_id") else "All",
            "supplier": None,               # butiksistem not connected yet
            "stage": stage,
            "odooCreatedDate": local_day(t["create_date"]),
            "firstOrderDate": local_day(first_order.get(tid)),
            "lastOrderDate": local_day(last_order.get(tid)),
            "orders": round(orders),
            "units": round(units),
            "revenue": round(revenue_by_tmpl.get(tid, 0.0)),
            "delivered": round(delivered),
            "returned": round(returned),
            "unitsBoughtFromSupplier": round(bought_by_tmpl.get(tid, 0.0)),
            "returnedStock": round(returned_stock),
            "unitPrice": t.get("list_price") or None,
            "orderVelocity7d": round(vel7, 2),
            "daysSinceLastOrder": days_since,
            "supplierStock": {"qty": None, "lastChecked": None, "source": "manual"},
        })

    # Daily time series (sparse — only days with activity are stored).
    # byProduct: odooId -> {"YYYY-MM-DD": [orderDocs, units, revenue]}
    # moves:     "YYYY-MM-DD" -> [delivered, returned]   (portfolio units)
    # orders:    "YYYY-MM-DD" -> distinct confirmed order docs (whole shop)
    by_product = {}
    for t in templates:
        tid = t["id"]
        days = daily_sales.get(tid)
        if not days:
            continue
        by_product[str(tid)] = {
            day: [len(v[0]), round(v[1]), round(v[2])]
            for day, v in sorted(days.items())
            if v[0] or v[1] or v[2]
        }
    moves_out = {
        day: [round(v[0]), round(v[1])]
        for day, v in sorted(daily_moves.items())
        if (v[0] or v[1]) and day >= daily_from
    }

    payload = {
        "syncedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "currency": currency,
        "source": "odoo-live",
        "tz": "Asia/Baghdad",
        "products": products,
        "shop": {
            "stockUnits": round(shop_units),
            "stockValue": round(shop_value),
            "stockVariants": shop_products,
        },
        "daily": {
            "days": DAILY_DAYS,
            "from": daily_from,
            "to": today.isoformat(),
            "byProduct": by_product,
            "moves": moves_out,
            "orders": {day: n for day, n in sorted(daily_orders.items())
                       if day >= daily_from},
        },
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    tmp = OUT_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    os.replace(tmp, OUT_PATH)

    stages = {}
    for p in products:
        stages[p["stage"]] = stages.get(p["stage"], 0) + 1
    log(f"done in {time.time() - t0:.1f}s — {len(products)} products → {OUT_PATH}")
    log(f"stage mix: {stages}")


if __name__ == "__main__":
    sys.exit(main())
