#!/usr/bin/env python3
"""PulseStock Stage 2 — live Odoo sync connector.

Pulls the active product lifecycle set from a real Odoo 18 Enterprise via the
JSON-RPC external API and writes `public/data/live.json` for the frontend.

Pure Python 3 stdlib (urllib/json/os/datetime) — no pip packages.

Data selection
--------------
ACTIVE-LIFECYCLE product templates = union of
  A) create_date >= today - 120 days  (recently created) — ALL templates in
     this window, whether or not they are flagged "Can be Sold" (sale_ok),
  B) templates with sale.order.line rows in confirmed orders
     (state in sale/done) created within the last 90 days,
EXCLUDING pseudo-products: delivery.carrier products, loyalty discount
products, and manual-discount lines (PSEUDO_NAMES). Safety cap 1000
(list is ordered create_date desc, so the newest templates are kept).

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

Extra top-level blocks (Cash P&L page, compact keys — see sections 6c/6d)
--------------------------------------------------------------------------
  ordersDetail  confirmed orders (sale/done) from the last 120 local days,
                order-line granularity: {id, d, src?, ful?, st, fee, disc,
                lines:[{sku, qty, price, discPct, route?, del, ret?}]}
  stockDetail   every variant with qty_available > 0 OR created in the last
                180 days: {sku, model, qty, cost, created}
Field names (source, "نوع التجهيز") are discovered at runtime via fields_get,
never hardcoded. Delivery-fee lines fold into order `fee`; discount lines
("خصم", loyalty) fold into order `disc` (negative).

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
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ENV_PATH = os.path.join(ROOT, ".env")
OUT_PATH = os.path.join(ROOT, "public", "data", "live.json")

RECENT_CREATE_DAYS = 120   # selection window A
RECENT_ORDER_DAYS = 90     # selection window B (covers the whole daily series)
MAX_PRODUCTS = 1000        # safety cap only — candidates are ordered
                           # create_date desc, so the newest are kept
VELOCITY_DAYS = 7
DAILY_DAYS = 90            # daily time-series depth for window selectors
ORDERS_DETAIL_DAYS = 120   # ordersDetail window (Cash P&L page)
STOCK_DETAIL_CREATE_DAYS = 180  # stockDetail: variants created within this window
TURKEY_ROUTE_NAME = "Order from Turkey"  # stock.route name => line route "turkey"
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
    carrier_variant_ids = set()   # delivery-fee products (folded into order fee)
    try:
        for c in odoo.kw("delivery.carrier", "search_read", [[]],
                         {"fields": ["product_id"]}):
            if c.get("product_id"):
                carrier_variant_ids.add(c["product_id"][0])
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
        [[["create_date", ">=", days_ago(RECENT_CREATE_DAYS)]]])
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

    # ── 6c. ordersDetail — order-line detail for the Cash P&L page ─────────
    # Confirmed sale orders (state sale/done) created in the last
    # ORDERS_DETAIL_DAYS local days, with per-line granularity. Field names
    # are discovered at runtime via fields_get (never hardcoded guesses):
    #   src  <- sale.order.source_id (utm.source) when present
    #   ful  <- the custom field labeled "نوع التجهيز" (x_studio_*), selection
    #           labels mapped via fields_get; falls back to line-route
    #           derivation ("turkey" when any line routes Order from Turkey)
    log("building ordersDetail (confirmed orders, last "
        f"{ORDERS_DETAIL_DAYS}d)…")
    so_fields = odoo.kw("sale.order", "fields_get", [],
                        {"attributes": ["string", "type", "selection"]})
    src_field = "source_id" if "source_id" in so_fields else None
    ful_field = None
    ful_labels = {}
    for fname, fdef in sorted(so_fields.items()):
        if "تجهيز" in (fdef.get("string") or ""):
            ful_field = fname
            if fdef.get("type") == "selection":
                ful_labels = dict(fdef.get("selection") or [])
            break
    log(f"  sale.order fields: src={src_field} ful={ful_field}")

    sol_fields = odoo.kw("sale.order.line", "fields_get", [],
                         {"attributes": ["type"]})
    line_fields = ["order_id", "product_id", "name", "display_type",
                   "product_uom_qty", "qty_delivered", "price_unit",
                   "price_total"]
    has_route = "route_id" in sol_fields
    if has_route:
        line_fields.append("route_id")

    detail_from = days_ago(ORDERS_DETAIL_DAYS)
    order_fields = ["name", "create_date", "state"]
    if src_field:
        order_fields.append(src_field)
    if ful_field:
        order_fields.append(ful_field)
    orders = odoo.kw(
        "sale.order", "search_read",
        [[["state", "in", ["sale", "done"]],
          ["create_date", ">=", detail_from]]],
        {"fields": order_fields, "limit": 20000, "order": "create_date desc"})
    order_ids = [o["id"] for o in orders]
    log(f"  {len(orders)} confirmed orders since {detail_from}")

    # Order lines, chunked by order id.
    lines = []
    for i in range(0, len(order_ids), 400):
        chunk = order_ids[i:i + 400]
        lines.extend(odoo.kw(
            "sale.order.line", "search_read",
            [[["order_id", "in", chunk]]],
            {"fields": line_fields, "limit": 20000}))
    log(f"  {len(lines)} order lines fetched")

    # SKU lookup: default_code beats display-name prefix.
    line_variant_ids = sorted({ln["product_id"][0] for ln in lines
                               if ln.get("product_id")})
    sku_of_variant = {}
    for i in range(0, len(line_variant_ids), 200):
        chunk = line_variant_ids[i:i + 200]
        for v in odoo.kw("product.product", "read",
                         [chunk, ["default_code"]]):
            sku_of_variant[v["id"]] = v.get("default_code") or None

    # Returned qty per sale line (cheap: one read_group on stock.move).
    ret_by_line = {}
    try:
        for r in odoo.read_group(
                "stock.move",
                [("origin_returned_move_id", "!=", False),
                 ("state", "=", "done"),
                 ("sale_line_id", "!=", False)],
                ["product_uom_qty:sum"], ["sale_line_id"]):
            if r.get("sale_line_id"):
                ret_by_line[r["sale_line_id"][0]] = \
                    r.get("product_uom_qty") or 0.0
    except Exception as e:
        log(f"  warning: per-line returns lookup failed ({e})")

    def line_sku(ln):
        pid = ln["product_id"][0]
        code = sku_of_variant.get(pid)
        if code:
            return code
        return (ln["product_id"][1] or "").split(" (")[0].strip()

    def is_discount_line(ln):
        pid = ln["product_id"][0] if ln.get("product_id") else None
        pname = (ln["product_id"][1] if ln.get("product_id") else "") or ""
        if pid is not None and pid in pseudo_variant_ids \
                and pid not in carrier_variant_ids:
            return True
        return pname.strip() in PSEUDO_NAMES

    pct_re = re.compile(r"(\d+(?:[.,]\d+)?)\s*%")
    lines_by_order = {}
    for ln in lines:
        if ln.get("display_type"):          # sections/notes are not products
            continue
        oid = ln["order_id"][0] if ln.get("order_id") else None
        if oid is not None:
            lines_by_order.setdefault(oid, []).append(ln)

    orders_detail = []
    for o in orders:
        oid = o["id"]
        olines = lines_by_order.get(oid, [])
        fee = 0.0
        disc = 0.0
        disc_pcts = []
        product_lines = []
        any_turkey = False
        for ln in olines:
            pid = ln["product_id"][0] if ln.get("product_id") else None
            total = ln.get("price_total") or 0.0
            if pid is not None and pid in carrier_variant_ids:
                fee += total
                continue
            if is_discount_line(ln):
                disc += total
                m = pct_re.search(ln.get("name") or "")
                if m:
                    disc_pcts.append(float(m.group(1).replace(",", ".")))
                continue
            qty = ln.get("product_uom_qty") or 0.0
            price = round(total / qty) if qty else round(
                ln.get("price_unit") or 0.0)
            route = None
            if has_route and ln.get("route_id") \
                    and ln["route_id"][1] == TURKEY_ROUTE_NAME:
                route = "turkey"
                any_turkey = True
            entry = {"sku": line_sku(ln),
                     "qty": round(qty),
                     "price": price,
                     "discPct": 0,
                     "del": round(ln.get("qty_delivered") or 0.0)}
            if route:
                entry["route"] = route
            ret = ret_by_line.get(ln["id"], 0.0)
            if ret:
                entry["ret"] = round(ret)
            product_lines.append(entry)
        # Attach the discount percent to product lines only when unambiguous
        # (every discount line in the order shows the same percent).
        if disc_pcts and len(set(disc_pcts)) == 1:
            pct = round(disc_pcts[0], 1)
            for entry in product_lines:
                entry["discPct"] = pct

        src = o[src_field][1] if src_field and o.get(src_field) else None
        ful = None
        if ful_field and o.get(ful_field):
            fv = o[ful_field]
            if isinstance(fv, list):          # many2one -> display name
                ful = fv[1]
            else:                             # selection -> label
                ful = ful_labels.get(fv, fv)
        if not ful and any_turkey:
            ful = "turkey"
        rec = {"id": o.get("name") or str(oid),
               "d": local_day(o.get("create_date")),
               "st": o.get("state"),
               "fee": round(fee),
               "disc": round(disc),
               "lines": product_lines}
        if src:
            rec["src"] = src
        if ful:
            rec["ful"] = ful
        orders_detail.append(rec)
    log(f"  ordersDetail: {len(orders_detail)} orders, "
        f"{sum(len(o['lines']) for o in orders_detail)} product lines")

    # ── 6d. stockDetail — per-variant stock for the Cash P&L page ──────────
    # Every variant with qty_available > 0 OR created in the last
    # STOCK_DETAIL_CREATE_DAYS days. sku = variant display name, model = name
    # before " (", cost = standard_price (AVCO) in IQD.
    log("building stockDetail…")
    stock_detail = []
    offset = 0
    sd_domain = ["|", ["qty_available", ">", 0],
                 ["create_date", ">=", days_ago(STOCK_DETAIL_CREATE_DAYS)]]
    while True:
        batch = odoo.kw(
            "product.product", "search_read", [sd_domain],
            {"fields": ["name", "qty_available", "standard_price",
                        "create_date"],
             "limit": 2000, "offset": offset})
        for v in batch:
            if v["id"] in pseudo_variant_ids:
                continue
            name = (v.get("name") or "").strip()
            if name in PSEUDO_NAMES:
                continue
            stock_detail.append({
                "sku": name,
                "model": name.split(" (")[0].strip(),
                "qty": round(v.get("qty_available") or 0.0),
                "cost": round(v.get("standard_price") or 0.0),
                "created": local_day(v.get("create_date")),
            })
        if len(batch) < 2000:
            break
        offset += 2000
    sd_units = sum(i["qty"] for i in stock_detail if i["qty"] > 0)
    sd_value = sum(i["qty"] * i["cost"] for i in stock_detail if i["qty"] > 0)
    log(f"  stockDetail: {len(stock_detail)} variants, "
        f"{sd_units:.0f} on-hand units, ≈{sd_value:,.0f} {currency} at cost")

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
        "ordersDetail": orders_detail,
        "stockDetail": stock_detail,
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

    # ── Verification summary (reconcile vs ground truth) ────────────────────
    if orders_detail:
        n_ord = len(orders_detail)
        qty_sum = sum(l["qty"] for o in orders_detail for l in o["lines"])
        del_sum = sum(l["del"] for o in orders_detail for l in o["lines"])
        log(f"VERIFY ordersDetail: {n_ord} orders / {ORDERS_DETAIL_DAYS}d "
            f"= {n_ord / ORDERS_DETAIL_DAYS:.1f}/day "
            f"(expect ~4,300 orders, ~44/day)")
        log(f"VERIFY delivery rate: {del_sum}/{qty_sum} = "
            f"{(100.0 * del_sum / qty_sum if qty_sum else 0):.1f}% "
            "(expect ~72%)")
    log(f"VERIFY stock: {sd_units:.0f} units ≈{sd_value:,.0f} {currency} "
        "(expect ~2,034 units ≈60.5M IQD)")


if __name__ == "__main__":
    sys.exit(main())
