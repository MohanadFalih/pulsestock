#!/usr/bin/env python3
"""Print Odoo user ID -> display name for salespeople (READ-ONLY).

Names only, no performance figures. The owner asked for this; delete the
run log after use since the repository is public.
"""
import json
import os
import sys
import urllib.request

IDS = [18, 13, 37, 30, 21, 9, 8, 6, 2, 39]


def rpc(url, service, method, args):
    payload = {"jsonrpc": "2.0", "method": "call", "id": 1,
               "params": {"service": service, "method": method, "args": args}}
    req = urllib.request.Request(url + "/jsonrpc", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        res = json.load(r)
    if "error" in res:
        raise RuntimeError(res["error"].get("data", {}).get("message", res["error"]))
    return res["result"]


def main():
    url = os.environ["ODOO_URL"].rstrip("/")
    db, key = os.environ["ODOO_DB"], os.environ["ODOO_API_KEY"]
    uid = rpc(url, "common", "authenticate", [db, os.environ["ODOO_USER"], key, {}])
    rows = rpc(url, "object", "execute_kw",
               [db, uid, key, "res.users", "read", [IDS, ["name"]], {"context": {"active_test": False}}])
    out = {f"U{r['id']}": r["name"] for r in rows}
    print("\n=====DIAG_JSON_BEGIN=====")
    print(json.dumps(out, ensure_ascii=False))
    print("=====DIAG_JSON_END=====")


if __name__ == "__main__":
    sys.exit(main())
