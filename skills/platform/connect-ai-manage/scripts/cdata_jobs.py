#!/usr/bin/env python3
"""
CData Connect AI - Jobs helper (Admin UI BFF).

Drives the SAME endpoints the cloud.cdata.com web UI calls for the Jobs page,
under https://cloud.cdata.com/api/ui/*. These are authenticated with the browser
session Bearer token (the auth0 JWT the signed-in UI sends) -- the SAME token the
cdata-connect-workspaces skill uses, so they share ~/.cdata_token.

NOTE: the public REST API (/api/job/*, PAT/Basic auth) is the embedded-account
surface and is NOT what the web UI uses; it rejects the session JWT. The UI talks
to /api/ui/cacheJobs/* (and /api/ui/scheduledquery/*) with the Bearer token.

All endpoints, methods and request bodies below were captured from a
cloud.cdata.com HAR trace (June 2026):

  GET    /api/ui/cacheJobs/list
  GET    /api/ui/scheduledquery/list
  GET    /api/ui/cacheJobs/{id}
  GET    /api/ui/scheduledquery/{id}
  POST   /api/ui/cacheJobs                      (create; body: cacheSchemas[])
  POST   /api/ui/scheduledquery/create          (create; body: query + destination + schedule)
  PUT    /api/ui/cacheJobs/jobs/update          (update; body: cacheSchemas[] w/ id)
  POST   /api/ui/cacheJobs/run/{id}             (no body)
  PUT    /api/ui/cacheJobs/stop/{id}            (no body)
  DELETE /api/ui/cacheJobs/deleteBatch          (body: {"ids":[...]})
  DELETE /api/ui/scheduledquery/deleteBatch     (body: {"ids":[...]})

The two "Add Job" paths in the UI map to two creates:
  - Cache Job        -> create-job              (POST /cacheJobs)
  - Scheduled Query  -> create-scheduled-query  (POST /scheduledquery/create)

Token resolution order (shared with the workspaces helper):
  1. --token VALUE
  2. CDATA_TOKEN environment variable
  3. token file (default: ~/.cdata_token), overridable with --token-file or CDATA_TOKEN_FILE

Exit codes:
  0  success
  3  auth failure (401/403) -> caller should ask the user for a fresh token
  1  any other error

Output is JSON on stdout for machine steps, or a compact table for list commands.
Errors go to stderr.
"""
import argparse
import datetime
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import urllib.error

BASE = "https://cloud.cdata.com/api/ui"
DEFAULT_TOKEN_FILE = os.path.join(os.path.expanduser("~"), ".cdata_token")
GUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


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


def str2bool(s):
    return str(s).strip().lower() in ("1", "true", "yes", "y", "t")


# Enum decoders (best-effort labels; raw value is always preserved in --json).
JOB_TYPE = {1: "Caching", 2: "ScheduledQuery"}
# status.status seen: 2=Running, 3=Succeeded, 5=Failed, 6=NoChange/Skipped.
RUN_STATUS = {1: "Queued", 2: "Running", 3: "Succeeded", 4: "Cancelled", 5: "Failed", 6: "NoChange"}
# jobFrequencyUnit: UI dropdown order; treat as best-effort until each value is
# individually confirmed (4 and 5 observed on real jobs, 3 and 4 in HAR edits).
FREQ_UNIT = {1: "Minute", 2: "Hour", 3: "Day", 4: "Week", 5: "Month"}


def fetch_jobs(token):
    """Return (caching_jobs, scheduled_queries) from the two UI list endpoints."""
    _, c = request("GET", "/cacheJobs/list", token)
    _, s = request("GET", "/scheduledquery/list", token)
    caching = (c or {}).get("list", []) if isinstance(c, dict) else []
    scheduled = (s or {}).get("list", []) if isinstance(s, dict) else []
    return caching, scheduled


def all_jobs(token):
    caching, scheduled = fetch_jobs(token)
    for j in caching:
        j["_kind"] = "caching"
    for j in scheduled:
        j["_kind"] = "scheduledquery"
    return caching + scheduled


def find_job(token, id_or_name):
    """Resolve an id-or-name to a single job dict from the merged list."""
    jobs = all_jobs(token)
    match = [j for j in jobs if j.get("id") == id_or_name or j.get("name") == id_or_name]
    if not match:
        sys.stderr.write("No job with id or name %r. Run list-jobs to see options.\n" % id_or_name)
        sys.exit(1)
    if len(match) > 1:
        sys.stderr.write("Ambiguous: %d jobs match %r. Use the id.\n" % (len(match), id_or_name))
        sys.exit(1)
    return match[0]


def resolve_id(token, id_or_name):
    """Return a job GUID. A GUID is used as-is; a name is looked up in the list."""
    if GUID_RE.match(id_or_name or ""):
        return id_or_name
    return find_job(token, id_or_name)["id"]


# ---- commands ---------------------------------------------------------------

def cmd_verify(args, token):
    caching, scheduled = fetch_jobs(token)
    print("OK - token valid. %d caching job(s), %d scheduled query(ies)."
          % (len(caching), len(scheduled)))


def cmd_list_jobs(args, token):
    jobs = sorted(all_jobs(token), key=lambda j: (j.get("name") or "").lower())
    if args.json:
        out(jobs)
        return
    print("%-38s  %-14s  %-8s  %-10s  %s" % ("ID", "KIND", "ENABLED", "LAST_RUN", "NAME"))
    for j in jobs:
        st = (j.get("status") or {})
        run = RUN_STATUS.get(st.get("status"), st.get("status"))
        print("%-38s  %-14s  %-8s  %-10s  %s" % (
            j.get("id"), j.get("_kind"), j.get("enabled"), run, j.get("name")))
    print("\n%d job(s) total." % len(jobs))


def cmd_get_job(args, token):
    # Resolve via the merged list so we know the kind, then hit the matching
    # single-job endpoint: /cacheJobs/{id} for caching, /scheduledquery/{id} for
    # scheduled queries (both confirmed in the HAR trace).
    job = find_job(token, args.id)
    jid = job["id"]
    base = "/scheduledquery/" if job.get("_kind") == "scheduledquery" else "/cacheJobs/"
    status, data = request("GET", base + jid, token)
    out(data)


def cmd_create_job(args, token):
    if args.body or args.body_file:
        body = json.load(open(args.body_file, encoding="utf-8")) if args.body_file else json.loads(args.body)
    else:
        for req_attr in ("source_connection", "source_schema", "source_table",
                         "job_frequency", "job_frequency_unit"):
            if getattr(args, req_attr) is None:
                sys.stderr.write("create-job needs --source-connection, --source-schema, "
                                 "--source-table, --job-frequency and --job-frequency-unit "
                                 "(or pass --body / --body-file).\n")
                sys.exit(1)
        body = {
            "jobFrequencyUnit": args.job_frequency_unit,
            "jobFrequency": args.job_frequency,
            "cacheSchemas": [{
                "sourceConnection": args.source_connection,
                "sourceSchema": args.source_schema,
                "sourceTable": args.source_table,
                "isFullUpdate": True if args.full_update is None else args.full_update,
                "timeCheckColumn": args.time_check_column or "",
                "isAutoTruncateStrings": True if args.auto_truncate_strings is None else args.auto_truncate_strings,
            }],
        }
    status, data = request("POST", "/cacheJobs", token, body=body)
    out(data)


def cmd_create_scheduled_query(args, token):
    """Create a Scheduled Query job (the second 'Add Job' path in the UI).

    A scheduled query runs a SQL statement on a schedule and writes its result
    into a destination connection/schema/table -- it is NOT a cacheSchemas body.
    Body shape captured from POST /api/ui/scheduledquery/create.
    """
    if args.body or args.body_file:
        body = json.load(open(args.body_file, encoding="utf-8")) if args.body_file else json.loads(args.body)
    else:
        for req_attr in ("name", "query", "destination_connection", "destination_schema",
                         "destination_table", "job_frequency", "job_frequency_unit"):
            if getattr(args, req_attr) is None:
                sys.stderr.write("create-scheduled-query needs --name, --query, "
                                 "--destination-connection, --destination-schema, "
                                 "--destination-table, --job-frequency and "
                                 "--job-frequency-unit (or pass --body / --body-file).\n")
                sys.exit(1)
        # The UI sends definedNextRun as the first run time; default to "now" (UTC)
        # so the job is scheduled immediately, matching the UI's behavior.
        next_run = args.defined_next_run or (
            datetime.datetime.now(datetime.timezone.utc)
            .strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z")
        body = {
            "name": args.name,
            "destinationWriteScheme": args.destination_write_scheme,
            "destinationConnection": args.destination_connection,
            "destinationSchema": args.destination_schema,
            "destinationTable": args.destination_table,
            "jobFrequency": args.job_frequency,
            "jobFrequencyUnit": args.job_frequency_unit,
            "query": args.query,
            "enabled": True if args.enabled is None else args.enabled,
            "logVerbosity": 2 if args.verbosity is None else args.verbosity,
            "definedNextRun": next_run,
        }
    status, data = request("POST", "/scheduledquery/create", token, body=body)
    out(data)


def cmd_update_job(args, token):
    if args.body or args.body_file:
        body = json.load(open(args.body_file, encoding="utf-8")) if args.body_file else json.loads(args.body)
        status, data = request("PUT", "/cacheJobs/jobs/update", token, body=body)
        out(data)
        return
    # Fetch current job, then overlay only the flags the user supplied so nothing
    # the user didn't touch gets dropped.
    jid = resolve_id(token, args.id)
    _, cur = request("GET", "/cacheJobs/" + jid, token)
    eff_tcc = args.time_check_column if args.time_check_column is not None else cur.get("timeCheckColumn", "")
    schema = {
        "id": jid,
        "enabled": cur.get("enabled", True) if args.enabled is None else args.enabled,
        "isAutoTruncateStrings": cur.get("isAutoTruncateStrings", True) if args.auto_truncate_strings is None else args.auto_truncate_strings,
        "sourceConnection": args.source_connection or cur.get("sourceConnection"),
        "sourceSchema": args.source_schema or cur.get("sourceSchema"),
        "sourceTable": args.source_table or cur.get("sourceTable"),
        # isFullUpdate isn't returned on a job; if unset, infer from the time-check
        # column (empty => full refresh, populated => incremental).
        "isFullUpdate": (not eff_tcc) if args.full_update is None else args.full_update,
        "timeCheckColumn": eff_tcc,
    }
    body = {
        "jobFrequencyUnit": args.job_frequency_unit if args.job_frequency_unit is not None else cur.get("jobFrequencyUnit"),
        "jobFrequency": args.job_frequency if args.job_frequency is not None else cur.get("jobFrequency"),
        "verbosity": args.verbosity if args.verbosity is not None else cur.get("logVerbosity", 3),
        "cacheSchemas": [schema],
    }
    status, data = request("PUT", "/cacheJobs/jobs/update", token, body=body)
    out(data)


def cmd_run_job(args, token):
    jid = resolve_id(token, args.id)
    status, data = request("POST", "/cacheJobs/run/" + jid, token)
    print("Queued job %s to run (HTTP %d). Use get-job to watch status." % (jid, status))
    if data is not None:
        out(data)


def cmd_stop_job(args, token):
    jid = resolve_id(token, args.id)
    status, data = request("PUT", "/cacheJobs/stop/" + jid, token)
    print("Requested stop for job %s (HTTP %d)." % (jid, status))
    if data is not None:
        out(data)


def cmd_delete_job(args, token):
    if not getattr(args, "confirm", False):
        raise SystemExit("Refusing to delete job %s without --confirm (destructive)." % args.id)
    job = find_job(token, args.id)
    jid = job["id"]
    endpoint = "/scheduledquery/deleteBatch" if job.get("_kind") == "scheduledquery" else "/cacheJobs/deleteBatch"
    status, data = request("DELETE", endpoint, token, body={"ids": [jid]})
    print("Deleted job %s (%s) (HTTP %d)." % (jid, job.get("name"), status))
    if data is not None:
        out(data)


def add_create_update_flags(sp, for_update=False):
    sp.add_argument("--body", help="full request body as a JSON string (overrides convenience flags)")
    sp.add_argument("--body-file", help="path to a JSON file holding the full request body")
    sp.add_argument("--source-connection", help="source connection GUID")
    sp.add_argument("--source-schema")
    sp.add_argument("--source-table")
    sp.add_argument("--job-frequency", type=int, help="integer interval value")
    sp.add_argument("--job-frequency-unit", type=int,
                    help="interval unit code (1=Minute,2=Hour,3=Day,4=Week,5=Month; best-effort)")
    sp.add_argument("--full-update", type=str2bool, default=None, help="true|false (false = incremental)")
    sp.add_argument("--time-check-column", default=None, help="incremental check column ('' for full refresh)")
    sp.add_argument("--auto-truncate-strings", type=str2bool, default=None, help="true|false")
    if for_update:
        sp.add_argument("--enabled", type=str2bool, default=None, help="true|false")
        sp.add_argument("--verbosity", type=int, default=None, help="log verbosity integer")


def add_scheduled_query_flags(sp):
    sp.add_argument("--body", help="full request body as a JSON string (overrides convenience flags)")
    sp.add_argument("--body-file", help="path to a JSON file holding the full request body")
    sp.add_argument("--name", help="scheduled query / job name")
    sp.add_argument("--query", help="SQL statement to run, e.g. SELECT * FROM [conn].[schema].[table]")
    sp.add_argument("--destination-connection", help="destination connection GUID")
    sp.add_argument("--destination-schema", help="destination schema")
    sp.add_argument("--destination-table", help="destination table")
    sp.add_argument("--destination-write-scheme", type=int, default=1,
                    help="how results are written to the destination (UI default: 1)")
    sp.add_argument("--job-frequency", type=int, help="integer interval value")
    sp.add_argument("--job-frequency-unit", type=int,
                    help="interval unit code (1=Minute,2=Hour,3=Day,4=Week,5=Month; best-effort)")
    sp.add_argument("--enabled", type=str2bool, default=None, help="true|false (default true)")
    sp.add_argument("--verbosity", type=int, default=None, help="log verbosity integer (default 2)")
    sp.add_argument("--defined-next-run", default=None,
                    help="ISO-8601 UTC first-run time (default: now)")


def build_parser():
    p = argparse.ArgumentParser(description="CData Connect AI Jobs helper (UI BFF)")
    p.add_argument("--token")
    p.add_argument("--token-file")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("verify").set_defaults(func=cmd_verify)

    sp = sub.add_parser("list-jobs"); sp.add_argument("--json", action="store_true"); sp.set_defaults(func=cmd_list_jobs)
    sp = sub.add_parser("get-job"); sp.add_argument("--id", required=True, help="job id or exact name"); sp.set_defaults(func=cmd_get_job)

    sp = sub.add_parser("create-job"); add_create_update_flags(sp); sp.set_defaults(func=cmd_create_job)
    sp = sub.add_parser("create-scheduled-query"); add_scheduled_query_flags(sp); sp.set_defaults(func=cmd_create_scheduled_query)
    sp = sub.add_parser("update-job"); sp.add_argument("--id", required=True, help="job id or exact name"); add_create_update_flags(sp, for_update=True); sp.set_defaults(func=cmd_update_job)

    sp = sub.add_parser("run-job"); sp.add_argument("--id", required=True, help="job id or exact name"); sp.set_defaults(func=cmd_run_job)
    sp = sub.add_parser("stop-job"); sp.add_argument("--id", required=True, help="job id or exact name"); sp.set_defaults(func=cmd_stop_job)
    sp = sub.add_parser("delete-job"); sp.add_argument("--id", required=True, help="job id or exact name"); sp.add_argument("--confirm", action="store_true", help="required to actually delete (destructive)"); sp.set_defaults(func=cmd_delete_job)
    return p


def main():
    args = build_parser().parse_args()
    token = resolve_token(args)
    args.func(args, token)


if __name__ == "__main__":
    main()
