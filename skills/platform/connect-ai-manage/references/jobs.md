# Jobs — cache jobs & scheduled queries

Manage Connect AI **Jobs** the same way the cloud.cdata.com web UI does, via its Admin UI BFF endpoints (`/api/ui/cacheJobs/*` and `/api/ui/scheduledquery/*`): list, get, create, update, run, stop, and delete caching jobs and scheduled queries. All work goes through the bundled helper [`scripts/cdata_jobs.py`](../scripts/cdata_jobs.py), which handles auth, request shaping, and parsing so each operation is a single reliable command.

Run everything as: `python scripts/cdata_jobs.py <command> [flags]` (Windows: use `py` if `python` isn't on PATH)

> Why the UI BFF and not `/api/job/*`: the public REST API at `cloud.cdata.com/api/job/*` (PAT / Basic auth) is the **embedded-account** surface — it rejects the session JWT with `signature key was not found`. The web UI itself calls `/api/ui/cacheJobs/*` with the **Bearer token**. All endpoints and request bodies here were captured from a cloud.cdata.com HAR trace and verified live (June 2026).

## Token handling

Same resolution order as the workspaces helper (they share everything):
1. `--token VALUE` → 2. `CDATA_TOKEN` env var → 3. `~/.cdata_token` file → 4. **the skill's Auth0 CLI cache** (`%LOCALAPPDATA%\CData\connect-auth.json`, written by `node scripts/connect-cli.mjs login`).

In **Claude Code**, one CLI sign-in covers jobs too. The helper exits with **code 3** on any 401/403 — re-run `login` (silent refresh) and retry. Run `verify` on the session's first jobs request; `OK` means proceed.

## When the user asks generally ("work with jobs")

Don't start any operation on your own. Present the menu and wait:

```
Please select an operation:

  1. List all jobs
  2. View job details
  3. Create a new Cache Job
  4. Create a new Scheduled Query
  5. Update an existing job
  6. Run a job now
  7. Stop a running job
  8. Delete a job
```

> The cloud.cdata.com **+ Add Job** menu has two create paths — **Cache Job** and **Scheduled Query** — and so does this skill. A **Cache Job** caches a source table (`create-job`); a **Scheduled Query** runs a SQL statement on a schedule and writes the result into a destination table (`create-scheduled-query`). When the user says "create a job," ask which of the two they mean.

When the user's opening message already names a specific operation ("list my jobs", "run job X"), skip the menu and do exactly that one thing. Never chain operations the user didn't ask for, and never pick inputs on their behalf — which job, which connection, which schedule, which source table are all the user's choices. When something is needed and unspecified, list the available options and ask; don't guess.

## Commands

| Operation | Command | Real endpoint |
|-----------|---------|---------------|
| Verify token | `verify` | `GET /api/ui/cacheJobs/list` (+ `/scheduledquery/list`) |
| List jobs | `list-jobs` (add `--json` for raw) | `GET /api/ui/cacheJobs/list` + `GET /api/ui/scheduledquery/list` |
| Get a job | `get-job --id JOB_ID_OR_NAME` | `GET /api/ui/cacheJobs/{id}` (scheduled queries: `GET /api/ui/scheduledquery/{id}`) |
| Create a cache job | `create-job [flags]` | `POST /api/ui/cacheJobs` |
| Create a scheduled query | `create-scheduled-query [flags]` | `POST /api/ui/scheduledquery/create` |
| Update a job | `update-job --id JOB_ID_OR_NAME [flags]` | `PUT /api/ui/cacheJobs/jobs/update` |
| Run a job now | `run-job --id JOB_ID_OR_NAME` | `POST /api/ui/cacheJobs/run/{id}` |
| Stop a job | `stop-job --id JOB_ID_OR_NAME` | `PUT /api/ui/cacheJobs/stop/{id}` |
| Delete a job | `delete-job --id JOB_ID_OR_NAME` | `DELETE /api/ui/cacheJobs/deleteBatch` (scheduled queries: `/scheduledquery/deleteBatch`) |

`--id` accepts a job **GUID or its exact name** — names are resolved to ids from the list automatically, so you never have to make the user hunt for a GUID.

## The job model (as returned by the UI BFF)

`list` is the array under each list response (`{ "accountId": ..., "list": [...] }`); `get-job`, `create-job` and `update-job` return the job object(s) directly. Fields:

- `id`, `name`, `enabled`, `jobType` (int; `1` = Caching, `2` = ScheduledQuery), `isCached`
- Source: `sourceConnection` (connection GUID), `sourceConnectionName`, `sourceConnectionDriver`, `sourceSchema`, `sourceTable`, `timeCheckColumn`, `isAutoTruncateStrings`, `mergeKeys`
- Schedule: `jobFrequency` (int) + `jobFrequencyUnit` (int enum), `definedNextRun`, `logVerbosity`
- `created`, `lastModified`
- `status` (object): `lastRunId`, `lastRun`, `lastRunDuration`, `status` (int enum — `2`=Running, `3`=Succeeded, `5`=Failed, `6`=NoChange observed), `info` (human-readable run message, holds the real failure reason), `rowsAffected`, `nextRun`

`jobFrequencyUnit` integer mapping is best-effort (`1`=Minute, `2`=Hour, `3`=Day, `4`=Week, `5`=Month); raw values are always preserved under `--json`.

## Building create / update bodies

The request body the BFF expects is **not** the flat job object — it nests the source under a `cacheSchemas` array:

- **create** (`POST /cacheJobs`):
  ```json
  {"jobFrequencyUnit":4,"jobFrequency":1,
   "cacheSchemas":[{"sourceConnection":"<GUID>","sourceSchema":"JIRA",
     "sourceTable":"Issues","isFullUpdate":true,"timeCheckColumn":"",
     "isAutoTruncateStrings":true}]}
  ```
- **update** (`PUT /cacheJobs/jobs/update`): same shape plus top-level `verbosity`, and each `cacheSchemas[]` entry carries `id` and `enabled`.

The helper assembles these from convenience flags: `--source-connection` (GUID), `--source-schema`, `--source-table`, `--job-frequency`, `--job-frequency-unit`, `--full-update true|false` (false = incremental), `--time-check-column`, `--auto-truncate-strings true|false`, and for update also `--enabled` and `--verbosity`. Pass `--body` / `--body-file` to send an exact JSON body instead (e.g. multi-table `cacheSchemas`).

- create requires `--source-connection`, `--source-schema`, `--source-table`, `--job-frequency`, `--job-frequency-unit`. Don't invent these — ask the user. The `sourceConnection` is a connection **GUID**; if the user names a connection, resolve it with `python scripts/cdata_workspaces.py list-connections --filter <name>` (or the CLI's `connections`).
- update **fetches the current job first** and overlays only the flags supplied, so unspecified fields are preserved. `isFullUpdate` is not returned on a job; if unset it's inferred from the time-check column (empty = full refresh).

### Scheduled Query create body

A **scheduled query** is a different shape entirely — no `cacheSchemas`. It runs a SQL statement and writes the result into a destination connection/schema/table:

- **create** (`POST /scheduledquery/create`):
  ```json
  {"name":"ScheduledQuery1","destinationWriteScheme":1,
   "destinationConnection":"<DEST_GUID>","destinationSchema":"Smartsheet",
   "destinationTable":"abc","jobFrequency":1,"jobFrequencyUnit":4,
   "query":"SELECT * FROM [Jira_Anant_Test].[JIRA].[Projects]",
   "enabled":true,"logVerbosity":2,"definedNextRun":"2026-06-10T09:31:13.605Z"}
  ```
  The response is the created job with its new `id` and `jobType:2`.

The helper assembles this from convenience flags: `--name`, `--query` (the SQL), `--destination-connection` (GUID), `--destination-schema`, `--destination-table`, `--job-frequency`, `--job-frequency-unit`, plus optional `--destination-write-scheme` (default `1`), `--enabled` (default true), `--verbosity` (default `2`), and `--defined-next-run` (defaults to **now**, so it schedules immediately). Pass `--body` / `--body-file` to send an exact JSON body instead.

- create-scheduled-query requires `--name`, `--query`, `--destination-connection`, `--destination-schema`, `--destination-table`, `--job-frequency`, `--job-frequency-unit`. Don't invent these — ask the user. The `query` references source tables by their fully-qualified `[connection].[schema].[table]` name, and `destinationConnection` is a **GUID**; resolve any named connection via `list-connections`.

## Workflows

Pick jobs by name for the user. When an operation needs a job and the user hasn't named one unambiguously, run `list-jobs` and ask which.

### List jobs
Run `list-jobs`. It merges caching jobs and scheduled queries; present each with its kind, enabled state, and last-run status. Pass `--json` for exact field values.

### Get / open a job
Pass the name or id straight to `get-job --id ...`. Returns full JSON including the `status` block (`status.info` is the real reason a run failed).

### Create a Cache Job
Confirm job frequency + unit and the source connection GUID, schema, and table. Run `create-job` with the flags (or `--body-file` for multi-table), report the new job's id and name. Note: creating a job auto-queues its first run.

### Create a Scheduled Query
Confirm the SQL `query`, the destination connection GUID + schema + table, and the schedule (frequency + unit). Run `create-scheduled-query` with the flags (or `--body-file`), then report the new job's id and name. Like cache jobs, a scheduled query is queued to run at its `definedNextRun` (which defaults to now).

### Update a job
Resolve the job by name → id. The helper fetches the current job and applies only your changes, then PUTs. Report what changed.

### Run a job now
`run-job --id ...` queues it. If the job is already running you'll get `409 CACHE_JOB_RUNNING` — that's expected, not a bug.

### Stop a running job
`stop-job --id ...`.

### Delete a job
Always `list-jobs` first and confirm *which* one (by name) — deletion is destructive and not reversible. Echo back the name + id and get a clear go-ahead before `delete-job --id ...`. The helper routes to the right deleteBatch endpoint based on the job's kind and reports `deletedIds`.

## Notes
- Output is a compact table by default for `list-jobs`; pass `--json` for exact field values.
- `run-job` / `stop-job` return 200 with no body; the helper prints a one-line confirmation. `delete-job` returns `{deletedIds, failedDeletedIdsDetail}`.
- The HAR exporter strips the `Authorization` header, but the BFF is confirmed to accept the session Bearer token (the workspaces helper uses the same).
