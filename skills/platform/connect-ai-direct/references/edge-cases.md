# Edge cases, error recovery & live test log (data plane)

Data-plane (`/api/*`) edge cases for this skill. Every claim was **verified live against `cloud.cdata.com`** using a real credential. Admin-plane quirks (connection creation, PATs, jobs, workspaces, OAuth handshakes) live in the `connect-ai-manage` skill.

---

## Error → cause → fix (master table)

| HTTP / signal | Cause | Fix |
|---|---|---|
| `401` on `/api/*` | Credential missing / expired / revoked | Path A (Claude Code): re-run the CLI — it auto-refreshes. Path B (Claude Chat): re-create the PAT. See [authentication.md](authentication.md). |
| **HTTP 200 with `error` populated** | Query/request failed; `error.code` is a **string** (`INVALID_REQUEST`, …) | Inspect `error.message`; fix SQL/params. Never assume 200 = success. |
| `400` on `/api/schemas?catalogName=X` | The *data source's* vendor OAuth expired (not your token) | [Stale catalog](#stale-catalog) — pick a live catalog or have the owner reconnect. |
| `403` | RBAC — the signed-in user lacks the right | Surface it; ask an admin to grant Select/Insert/Update/Execute on the catalog. |
| `404` on a table/column | Driver case-sensitivity or wrong name | Re-run `/api/tables` / `/api/columns`; match exact case. |
| **`<!doctype html>` (HTTP 200)** | SPA-routing trap — browser path, not API | [SPA trap](#spa-trap) — use `/api/*`. |
| No server-side NL→SQL | `/api/ui/openai/*` routes removed from the product (2026-07-31) | [NL→SQL](#nl-sql) — compose SQL client-side from discovered schema. |
| `401` on `/api/async/*` | Async gateway wants PAT/Basic, rejects Auth0 | [Async](#async) — not relied on; use sync `/api/query`. |
| `/api/columns` returns 0 rows | Driver metadata cache quirk | [Columns empty](#columns-empty) — use `schemaOnly:true`. |
| `affectedRows: 0` on write | `WHERE` matched nothing, or read-only column | Verify the filter and column writability via `/api/columns`. |
| Procedure "missing parameter" | OUT params not declared | Include them with `direction:4, value:null`. |

---

<a id="spa-trap"></a>
## The SPA-routing trap (most confusing failure)

`cloud.cdata.com` is a single-page web app. Any path it doesn't recognize as an API route is **rewritten to the app's `index.html` and returned as HTTP 200 with `Content-Type: text/html`**. So a "200" can actually be a web page.

**Verified to fall into the trap (returned HTML, not data):**
- `GET /odata/` , `GET /odata/{workspaceName}` , `GET /odata/{workspace}/$metadata`
- `GET /api.rsc`
- `GET /openapi/v1/{workspaceName}`

**Detection:** if the response body starts with `<!doctype` or `<html`, you used a browser path. **Fix:** use the JSON API under `/api/*`. For tabular reads, `POST /api/query` (SQL) is the reliable, supported path.

---

<a id="async"></a>
## Async queries are not available on the Auth0 path

`POST /api/async/query` returned **`401`** with header **`WWW-Authenticate: Basic realm="Realm"`**. The async QueryGateway is a separate service that authenticates with Basic/PAT and **rejects the Auth0 Bearer token**, so it's unavailable on the Auth0 (Path A / Claude Code) path. This skill doesn't rely on async either way.

**What to do instead for long queries:** run them synchronously on `/api/query` with a larger `timeout`, narrow with `WHERE`/`LIMIT`, or pre-aggregate.

---

<a id="nl-sql"></a>
## No server-side NL→SQL — compose client-side

The portal's NL→SQL routes (`/api/ui/openai/*`) were **removed from the product on 2026-07-31** and no longer exist. (An earlier check recorded `400`s for every body shape tried, before the routes were deleted.)

**Do NL→SQL client-side:** discover the schema (`/api/schemas` → `/api/tables` → `/api/columns`, or `schemaOnly:true`), compose the SQL yourself, then run it on `/api/query`. This is fully under your control.

---

<a id="stale-catalog"></a>
## Stale catalog → 400 on /api/schemas

Many catalogs exist whose **underlying vendor OAuth has expired** (Salesforce, Zoho, etc.). `GET /api/schemas?catalogName=X` returns **400** for those — your credential is fine; the *data source's* login isn't.

On the pure data plane there's no `lastQueried` signal to pre-check liveness, so **try and handle**: if `/api/schemas` (or a query) returns `400` / `INVALID_LOGIN` for a catalog, treat that catalog as stale — pick a different one, or ask the connection owner to reconnect it (that's a `connect-ai-manage` / portal task).

---

<a id="columns-empty"></a>
## /api/columns returns 0 rows

On some drivers `GET /api/columns?...&tableName=T` returns an empty `rows` array even though the table exists and is queryable (metadata-cache quirk). *(In testing it worked for most drivers — this is driver-specific, not universal.)*

**Reliable fallback** — schema-only query returns full column metadata with zero rows:
```powershell
$b = '{"query":"SELECT * FROM [Cat].[Schema].[Table] LIMIT 1","schemaOnly":true}'
$r = Invoke-RestMethod -Method Post "https://cloud.cdata.com/api/query" -Headers $H -ContentType "application/json" -Body $b
$r.results[0].schema | ForEach-Object { "$($_.columnName)  ($($_.dataType))" }
```

---

## HTTP 200 ≠ success (the error envelope)

A malformed query returns **HTTP 200** with:
```json
{ "error": { "code": "INVALID_REQUEST", "message": "Failed to parse query: Malformed SQL Statement: Unrecognized keyword: SELCT ..." } }
```
`error.code` is a **string**. Always branch on the presence of `error` before reading `results`/`rows`. Known codes: `INVALID_REQUEST`, `INVALID_AUTHORIZATION`.

---

## Live test log — data plane (Auth0 Bearer, account CDataSupport)

Data-plane behaviors verified live. Objects created during any write test were cleaned up afterward.

| Area | Test | Result |
|---|---|---|
| Auth | token via bundled script; smoke test on `/api/catalogs` | ✅ 200 |
| Discover | `GET /api/catalogs` | ✅ 388–415 catalogs |
| Discover | `GET /api/schemas` / `/api/tables` / `/api/columns` on a live catalog | ✅ (columns via metadata endpoint) |
| Discover | `GET /api/procedures` | ✅ |
| Stale catalog | `/api/schemas` on a catalog with expired vendor creds | ✅ `400` / `INVALID_LOGIN` raised (not a fake success) |
| Query | valid `SELECT … LIMIT 3` | ✅ 200, rows |
| Query | `schemaOnly:true` | ✅ 200, columns, 0 rows |
| Query | **bad SQL** | ✅ **HTTP 200** with `error.code="INVALID_REQUEST"` (string) |
| Query | parameterized (`@nm`, dataType 5) | ✅ 200, rows |
| Write | INSERT / UPDATE with bound params | ✅ `affectedRows` returned |
| Safety | `DELETE` SQL | ✅ blocked client-side |
| Negative | `POST /api/async/query` | ⚠️ `401`, `WWW-Authenticate: Basic` (async needs PAT/Basic) |
| Negative | `GET /odata/{ws}` · `/api.rsc` · `/openapi/v1/{ws}` | ⚠️ 200 **text/html** (SPA trap) |

> Admin-plane verification (connections, drivers, users, PATs, workspaces, toolkits, jobs, scripted OAuth) is logged in the `connect-ai-manage` skill.
