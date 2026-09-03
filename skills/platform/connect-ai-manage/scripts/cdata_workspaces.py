#!/usr/bin/env python3
"""
CData Connect AI - Workspaces helper (Admin UI BFF).

One subcommand per operation. Every call reads a Bearer token (the token a
signed-in user's browser sends to https://cloud.cdata.com/api/ui/*), so this
talks to the same endpoints the Connect AI web UI uses.

Token resolution order:
  1. --token VALUE
  2. CDATA_TOKEN environment variable
  3. token file (default: ~/.cdata_token), overridable with --token-file or CDATA_TOKEN_FILE

Exit codes:
  0  success
  3  auth failure (401/403) -> caller should ask the user for a fresh token
  1  any other error

Output is JSON on stdout for machine steps, or a compact table for *-table
commands. Errors go to stderr.
"""
import argparse
import base64
import collections
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error

BASE = "https://cloud.cdata.com/api/ui"
DEFAULT_TOKEN_FILE = os.path.join(os.path.expanduser("~"), ".cdata_token")


def _cli_cache_token():
    """Fall back to the Auth0 token cached by connect-cli.mjs / cdata-connect-auth.ps1
    (one browser sign-in serves the CLI, the PowerShell helper, and this script)."""
    if sys.platform == "win32" and os.environ.get("LOCALAPPDATA"):
        path = os.path.join(os.environ["LOCALAPPDATA"], "CData", "connect-auth.json")
    else:
        path = os.path.join(os.path.expanduser("~"), ".config", "CData", "connect-auth.json")
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            return (json.load(f).get("access_token") or "").strip() or None
    except (OSError, ValueError):
        return None


def resolve_token(args):
    if getattr(args, "token", None):
        return args.token.strip()
    env = os.environ.get("CDATA_TOKEN")
    if env:
        return env.strip()
    path = getattr(args, "token_file", None) or os.environ.get("CDATA_TOKEN_FILE") or DEFAULT_TOKEN_FILE
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    cached = _cli_cache_token()
    if cached:
        return cached
    sys.stderr.write(
        "No token found. Pass --token, set CDATA_TOKEN, save the token to %s, "
        "or sign in once with: node scripts/connect-cli.mjs login\n" % path
    )
    sys.exit(1)


def request(method, path, token, body=None, query=None):
    url = BASE + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = None
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        if e.code in (401, 403):
            sys.stderr.write("AUTH FAILED (HTTP %d). Token is invalid or expired.\n" % e.code)
            sys.stderr.write(raw + "\n")
            sys.exit(3)
        sys.stderr.write("HTTP %d on %s %s\n%s\n" % (e.code, method, url, raw))
        sys.exit(1)
    except urllib.error.URLError as e:
        sys.stderr.write("Network error on %s %s: %s\n" % (method, url, e))
        sys.exit(1)


def out(obj):
    print(json.dumps(obj, indent=2, ensure_ascii=False))


# ---- commands ---------------------------------------------------------------

def cmd_verify(args, token):
    status, data = request("GET", "/workspaces", token)
    n = len(data.get("workspaces", [])) if isinstance(data, dict) else 0
    print("OK - token valid. %d workspaces visible. accountId=%s" % (n, data.get("accountId")))


def cmd_list_workspaces(args, token):
    status, data = request("GET", "/workspaces", token)
    ws = data.get("workspaces", []) if isinstance(data, dict) else []
    ws = sorted(ws, key=lambda w: (w.get("name") or "").lower())
    if args.json:
        out(ws)
        return
    print("%-38s  %-5s  %s" % ("ID", "ASSETS", "NAME"))
    for w in ws:
        print("%-38s  %-5s  %s" % (w.get("id"), w.get("childCount"), w.get("name")))
    print("\n%d workspaces." % len(ws))


def cmd_create_workspace(args, token):
    status, data = request("POST", "/workspaces", token, body={"name": args.name})
    out(data)


def cmd_get_workspace(args, token):
    status, data = request("GET", "/workspaces/" + args.id, token)
    out(data)


def cmd_delete_workspace(args, token):
    if not getattr(args, "confirm", False):
        raise SystemExit("Refusing to delete workspace %s without --confirm (destructive)." % args.id)
    status, data = request("DELETE", "/workspaces/" + args.id, token)
    print("Deleted workspace %s (HTTP %d)" % (args.id, status))


def cmd_list_assets(args, token):
    status, data = request("GET", "/workspaces/" + args.id + "/children", token)
    assets = data.get("assets", []) if isinstance(data, dict) else []
    assets = sorted(assets, key=lambda a: (a.get("alias") or "").lower())
    if args.json:
        out(assets)
        return
    print("%-38s  %-8s  %s" % ("ASSET_ID", "TYPE", "ALIAS  (source: schema.table)"))
    for a in assets:
        src = "%s.%s" % (a.get("sourceSchema"), a.get("sourceTable"))
        print("%-38s  %-8s  %s  (%s, %s)" % (
            a.get("id"), a.get("sourceAssetType"), a.get("alias"), src, a.get("driver")))
    print("\n%d assets in workspace %s." % (len(assets), args.id))


def _name_of(obj):
    for k in ("name", "alias", "displayName", "title"):
        if obj.get(k):
            return obj.get(k)
    return ""


def cmd_list_toolkits(args, token):
    status, data = request("GET", "/toolkits", token)
    items = data.get("toolkits", []) if isinstance(data, dict) else (data or [])
    items = sorted(items, key=lambda t: (_name_of(t) or "").lower())
    if args.json:
        out(items)
        return
    print("%-38s  %-9s  %s" % ("TOOLKIT_ID", "ACTIVE", "NAME"))
    for t in items:
        print("%-38s  %-9s  %s" % (t.get("id"), t.get("isActive", t.get("active", "")), _name_of(t)))
    print("\n%d toolkits." % len(items))


def cmd_create_toolkit(args, token):
    status, data = request("POST", "/toolkits", token, body={"name": args.name})
    out(data)


def cmd_delete_toolkit(args, token):
    if not getattr(args, "confirm", False):
        raise SystemExit("Refusing to delete toolkit %s without --confirm (destructive)." % args.id)
    status, data = request("DELETE", "/toolkits/" + args.id, token)
    print("Deleted toolkit %s (HTTP %d)" % (args.id, status))


def cmd_list_tools(args, token):
    status, data = request("GET", "/toolkits/" + args.toolkit_id + "/tools", token)
    items = data.get("tools", []) if isinstance(data, dict) else (data or [])
    if args.json:
        out(items)
        return
    if args.raw:
        # Flat view: one row per backend record. Each data source produces two
        # records (a "source" tool and a "universal" tool), so this shows 2x the
        # cards the UI displays.
        print("%-38s  %-8s  %-24s  %-10s  %s" % ("TOOL_ID", "ACTIVE", "NAME", "KIND", "DESCRIPTION"))
        for t in items:
            name = t.get("displayName") or t.get("name") or ""
            kind = (t.get("config") or {}).get("type") or ""
            desc = (t.get("description") or "").replace("\n", " ")[:40]
            print("%-38s  %-8s  %-24s  %-10s  %s" % (t.get("id"), t.get("isActive", ""), name, kind, desc))
        print("\n%d tool records in toolkit %s." % (len(items), args.toolkit_id))
        return

    # Grouped view (default): mirror the UI — one entry per data source, with the
    # operations enabled under its Universal tool and its Source tool.
    groups = collections.OrderedDict()
    for t in items:
        groups.setdefault(t.get("name"), {})[(t.get("config") or {}).get("type")] = t

    print("%d data source(s) in toolkit %s:\n" % (len(groups), args.toolkit_id))
    for name, recs in groups.items():
        disp = next((r.get("displayName") for r in recs.values() if r.get("displayName")), name)
        print("- %s  (%s)" % (disp, name))

        uni = recs.get("universal")
        if uni:
            ops = (uni.get("config") or {}).get("operations") or []
            enabled = [o for o in ops if o.get("enabled")]
            print("    Universal  %d/%d enabled:" % (len(enabled), len(ops)))
            for o in enabled:
                print("        + %s" % (o.get("displayName") or o.get("name")))

        src = recs.get("source")
        if src:
            conf = (src.get("config") or {}).get("configuration") or {}
            active = [v for v in conf.values() if isinstance(v, dict) and v.get("isActive")]
            if conf:
                print("    Source     %d/%d enabled:" % (len(active), len(conf)))
                for v in active:
                    print("        + %s" % (v.get("displayName") or "?"))
        print()


MCP_TOOLKIT_URL = "https://mcp.cloud.cdata.com/mcp/toolkits/"


def cmd_toolkit_url(args, token):
    print(MCP_TOOLKIT_URL + args.toolkit_id)


def cmd_mcp_command(args, token):
    # Resolve the toolkit name (used as the MCP server name) if not supplied.
    name = args.name
    if not name:
        status, data = request("GET", "/toolkits", token)
        items = data.get("toolkits", []) if isinstance(data, dict) else (data or [])
        match = [t for t in items if t.get("id") == args.toolkit_id]
        if not match:
            sys.stderr.write("Toolkit id %s not found; pass --name explicitly.\n" % args.toolkit_id)
            sys.exit(1)
        name = _name_of(match[0]) or args.toolkit_id
    # Claude Code server names are simplest without spaces.
    server_name = "".join(name.split())
    url = MCP_TOOLKIT_URL + args.toolkit_id
    b64 = base64.b64encode(("%s:%s" % (args.user, args.pat)).encode("utf-8")).decode("ascii")
    header = 'Authorization: Basic %s' % b64
    header_masked = 'Authorization: Basic <base64 of %s:YOUR_PAT>' % args.user
    parts = ["claude", "mcp", "add", "--scope", args.scope,
             "--transport", "http", server_name, url, "--header", header]
    cmd = 'claude mcp add --scope %s --transport http %s %s --header "%s"' % (
        args.scope, server_name, url, header)
    cmd_masked = 'claude mcp add --scope %s --transport http %s %s --header "%s"' % (
        args.scope, server_name, url, header_masked)
    if args.run:
        import subprocess
        # Use the assembled arg list (no shell) so the secret isn't re-parsed.
        try:
            r = subprocess.run(parts, capture_output=True, text=True)
        except FileNotFoundError:
            sys.stderr.write("'claude' CLI not found on PATH. Run it yourself — re-run this with --show-secret to get the full command (it will contain your PAT). Masked form:\n" + cmd_masked + "\n")
            sys.exit(1)
        sys.stdout.write(r.stdout)
        sys.stderr.write(r.stderr)
        print("\n(added MCP server '%s' at scope '%s')" % (server_name, args.scope) if r.returncode == 0
              else "\nclaude mcp add exited with code %d" % r.returncode)
        sys.exit(r.returncode)
    # Do NOT print the live PAT by default — it would land in stdout/history/logs.
    if getattr(args, "show_secret", False):
        print(cmd)
    else:
        print(cmd_masked)
        sys.stderr.write("Note: PAT masked above. Use --run to add the server without exposing it, or --show-secret to print the full command (contains your PAT).\n")


def cmd_list_connections(args, token):
    status, data = request("GET", "/account/connections", token)
    conns = data.get("connections", []) if isinstance(data, dict) else []
    flt = (args.filter or "").lower()
    if flt:
        conns = [c for c in conns if flt in (c.get("name") or "").lower()
                 or flt in (c.get("driver") or "").lower()]
    conns = sorted(conns, key=lambda c: (c.get("name") or "").lower())
    if args.json:
        out(conns)
        return
    print("%-36s  %-22s  %s" % ("CONNECTION_ID", "DRIVER", "NAME (catalog)"))
    for c in conns:
        print("%-36s  %-22s  %s" % (c.get("id"), c.get("driver"), c.get("name")))
    print("\n%d connections." % len(conns))


def cmd_list_schemas(args, token):
    status, data = request("GET", "/schemas", token, query={"catalogName": args.catalog})
    if args.json:
        out(data)
        return
    for s in (data or []):
        print(s.get("schema"))
    print("\n%d schemas in catalog %s." % (len(data or []), args.catalog))


def cmd_list_tables(args, token):
    status, data = request("GET", "/tables", token,
                           query={"catalogName": args.catalog, "schemaName": args.schema})
    rows = data or []
    # The endpoint can return duplicates; collapse on (tableName, tableType).
    seen = {}
    for r in rows:
        key = (r.get("tableName"), r.get("tableType"))
        seen[key] = r
    rows = sorted(seen.values(), key=lambda r: (r.get("tableName") or "").lower())
    if args.json:
        out(rows)
        return
    print("%-10s  %s" % ("TYPE", "TABLE"))
    for r in rows:
        print("%-10s  %s" % (r.get("tableType"), r.get("tableName")))
    print("\n%d tables/views in %s.%s." % (len(rows), args.catalog, args.schema))


def cmd_create_assets(args, token):
    tables = [t.strip() for t in args.tables.split(",") if t.strip()]
    if not tables:
        sys.stderr.write("No tables given.\n")
        sys.exit(1)
    records = [{
        "AssetType": args.asset_type,
        "ConnectionId": args.connection_id,
        "DataAssetCategory": args.data_asset_category,
        "ParentId": None,
        "SchemaName": args.schema,
        "TableName": t,
    } for t in tables]
    status, data = request(
        "POST",
        "/workspaces/%s/assets/fromConnection/batch" % args.workspace_id,
        token,
        body={"Records": records},
    )
    print("Created %d asset(s) in workspace %s (HTTP %d)." % (len(records), args.workspace_id, status))
    if data is not None:
        out(data)


def build_parser():
    p = argparse.ArgumentParser(description="CData Connect AI Workspaces helper")
    p.add_argument("--token")
    p.add_argument("--token-file")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("verify").set_defaults(func=cmd_verify)

    sp = sub.add_parser("list-workspaces"); sp.add_argument("--json", action="store_true"); sp.set_defaults(func=cmd_list_workspaces)
    sp = sub.add_parser("create-workspace"); sp.add_argument("--name", required=True); sp.set_defaults(func=cmd_create_workspace)
    sp = sub.add_parser("get-workspace"); sp.add_argument("--id", required=True); sp.set_defaults(func=cmd_get_workspace)
    sp = sub.add_parser("list-assets"); sp.add_argument("--id", required=True); sp.add_argument("--json", action="store_true"); sp.set_defaults(func=cmd_list_assets)
    sp = sub.add_parser("delete-workspace"); sp.add_argument("--id", required=True); sp.add_argument("--confirm", action="store_true", help="required to actually delete (destructive)"); sp.set_defaults(func=cmd_delete_workspace)

    sp = sub.add_parser("list-toolkits"); sp.add_argument("--json", action="store_true"); sp.set_defaults(func=cmd_list_toolkits)
    sp = sub.add_parser("create-toolkit"); sp.add_argument("--name", required=True); sp.set_defaults(func=cmd_create_toolkit)
    sp = sub.add_parser("delete-toolkit"); sp.add_argument("--id", required=True); sp.add_argument("--confirm", action="store_true", help="required to actually delete (destructive)"); sp.set_defaults(func=cmd_delete_toolkit)
    sp = sub.add_parser("toolkit-url"); sp.add_argument("--toolkit-id", required=True); sp.set_defaults(func=cmd_toolkit_url)
    sp = sub.add_parser("mcp-command")
    sp.add_argument("--toolkit-id", required=True)
    sp.add_argument("--name", help="MCP server name; defaults to the toolkit's name")
    sp.add_argument("--user", required=True, help="CData Connect username (e.g. login email)")
    sp.add_argument("--pat", required=True, help="CData Personal Access Token")
    sp.add_argument("--scope", default="local", choices=["local", "user", "project"])
    sp.add_argument("--run", action="store_true", help="execute 'claude mcp add' instead of just printing it")
    sp.add_argument("--show-secret", action="store_true", help="print the full command including the PAT (default: masked)")
    sp.set_defaults(func=cmd_mcp_command)
    sp = sub.add_parser("list-tools"); sp.add_argument("--toolkit-id", required=True); sp.add_argument("--raw", action="store_true", help="flat per-record view instead of grouped-by-source"); sp.add_argument("--json", action="store_true"); sp.set_defaults(func=cmd_list_tools)

    sp = sub.add_parser("list-connections"); sp.add_argument("--filter"); sp.add_argument("--json", action="store_true"); sp.set_defaults(func=cmd_list_connections)
    sp = sub.add_parser("list-schemas"); sp.add_argument("--catalog", required=True); sp.add_argument("--json", action="store_true"); sp.set_defaults(func=cmd_list_schemas)
    sp = sub.add_parser("list-tables"); sp.add_argument("--catalog", required=True); sp.add_argument("--schema", required=True); sp.add_argument("--json", action="store_true"); sp.set_defaults(func=cmd_list_tables)

    sp = sub.add_parser("create-assets")
    sp.add_argument("--workspace-id", required=True)
    sp.add_argument("--connection-id", required=True)
    sp.add_argument("--schema", required=True)
    sp.add_argument("--tables", required=True, help="comma-separated table names")
    sp.add_argument("--asset-type", type=int, default=1)
    sp.add_argument("--data-asset-category", type=int, default=1)
    sp.set_defaults(func=cmd_create_assets)
    return p


def main():
    args = build_parser().parse_args()
    token = resolve_token(args)
    args.func(args, token)


if __name__ == "__main__":
    main()
