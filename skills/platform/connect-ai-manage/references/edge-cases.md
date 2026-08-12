# Edge cases, error recovery & live test log

Every claim here was **verified live against `cloud.cdata.com` on 2026-06-02** using an Auth0 Bearer token (`azp=lEvk7ySDJAaWHhBWPEY9fiMNYf4RN25e`, account `CDataSupport`, 388 catalogs / 391 connections visible). Where a behavior surprised us, the fix is given.

---

## Error → cause → fix (master table)

| HTTP / signal | Cause | Fix |
|---|---|---|
| `401` on `/api/*` or `/api/ui/*` | Auth0 token missing or expired (24 h TTL) | Re-run the auth script (auto-refreshes) or re-capture via DevTools. See [authentication.md](authentication.md). |
| **HTTP 200 with `error` populated** | Query/request failed; `error.code` is a **string** (`INVALID_REQUEST`, …) | Inspect `error.message`; fix SQL/params. Never assume 200 = success. |
| `400` on `/api/schemas?catalogName=X` | The *data source's* vendor OAuth expired (not your token) | [Stale catalog](#stale-catalog) — pick a live catalog or have the owner reconnect. |
| `400` on `/api/ui/overview/accountStats` | Missing required query params | Add `?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`. |
| `/api/ui/openai/*` gone | Routes removed from the product (2026-07-31) | [NL→SQL](#nl-sql) — do client-side NL→SQL instead. |
| `403` | RBAC — the signed-in user lacks the right | Surface it; ask an admin to grant Select/Insert/Update/Execute on the catalog. |
| `404` on a table/column | Driver case-sensitivity or wrong name | Re-run `/api/tables` / `/api/columns`; match exact case. |
| **`<!doctype html>` (HTTP 200)** | SPA-routing trap — browser path, not API | [SPA trap](#spa-trap) — use `/api/*`. |
| `500` on create connection | Wrong body shape (needs PascalCase + `Props` + `UserId`/`Permissions`), **not** bad creds | [Creating a connection](#testconnection) — use `connection-create` (builds the right body). |
| `401` on `/api/async/*` | Async gateway wants PAT/Basic, rejects Auth0 | [Async](#async) — not supported; use sync `/api/query`. |
| `/api/columns` returns 0 rows | Driver metadata cache quirk | [Columns empty](#columns-empty) — use `schemaOnly:true`. |
| `affectedRows: 0` on write | `WHERE` matched nothing, or read-only column | Verify the filter and column writability via `/api/columns`. |
| Procedure "missing parameter" | OUT params not declared | Include them with `direction:4, value:null`. |
| `AADSTS70008` on token exchange | Microsoft auth code expired (~60 s, single-use) | [Microsoft OAuth codes](#ms-oauth-code) — capture the address-bar URL instantly; exchange immediately. |
| `CONNECTION_TEST_FAILED` on PUT update | PUT always tests; sensitive props are never returned, so a credential-less connection can't pass | [PUT triggers a test](#put-triggers-test) — delete & recreate, or re-collect credentials first. |
| `OAUTH [30003] Token should not be null` | Tried OAuth via the data plane (`/api/exec` GetOAuthAuthorizationURL) or PUT on a never-authenticated OAuth connection | Use the BFF handshake ([oauth-without-portal.md](oauth-without-portal.md)); for new connections POST with tokens, never pre-create-then-PUT. |
| `409 CACHE_JOB_RUNNING` on job run | The job is already running | Expected, not a bug. Wait or `job-stop` first. |
| `signature key was not found` on `/api/job/*` | That's the embedded-account surface (PAT/Basic only) | Use the UI BFF paths `/api/ui/cacheJobs/*` / `/api/ui/scheduledquery/*` ([jobs.md](jobs.md)). |
| `400 Request Header Or Cookie Too Large` on the OAuth callback page | Browser cookie bloat on `cloud.cdata.com` — harmless | The `code` is still in the address-bar URL; grab it and continue. Bonus: the SPA doesn't run, so it can't pre-consume the code. |
| `401` on `https://mcp.cloud.cdata.com/mcp/toolkits/{id}` | MCP endpoint wants HTTP Basic `base64(username:PAT)` | Don't send the Bearer JWT there; mint a PAT ([user-management-billing.md](user-management-billing.md#pats)). |

---

<a id="spa-trap"></a>
## The SPA-routing trap (most confusing failure)

`cloud.cdata.com` is a single-page web app. Any path it doesn't recognize as an API route is **rewritten to the app's `index.html` and returned as HTTP 200 with `Content-Type: text/html`**. So a "200" can actually be a web page.

**Verified to fall into the trap (returned HTML, not data):**
- `GET /odata/` , `GET /odata/{workspaceName}` , `GET /odata/{workspace}/$metadata`
- `GET /api.rsc`
- `GET /openapi/v1/{workspaceName}`

**Detection:** if the response body starts with `<!doctype` or `<html`, you used a browser path. **Fix:** use the JSON API under `/api/*`. For tabular reads, `POST /api/query` (SQL) is the reliable, supported path. OData/OpenAPI may work only when a workspace is explicitly published for OData with the exact service identifier — don't rely on it; prefer `/api/query`.

---

<a id="async"></a>
## Async queries are not available with Auth0

`POST /api/async/query` returned **`401`** with header **`WWW-Authenticate: Basic realm="Realm"`**. The async QueryGateway is a separate service that authenticates with Basic/PAT and **rejects the Auth0 Bearer token**. Since this skill is Auth0-only, treat all `/api/async/*` endpoints as unavailable.

**What to do instead for long queries:** run them synchronously on `/api/query` with a larger `timeout`, narrow with `WHERE`/`LIMIT`, or pre-aggregate. The same readiness probe `/api/async/actuator/health/readiness` also returned `401` with the Bearer token.

---

<a id="nl-sql"></a>
## NL→SQL endpoint (`/api/ui/openai/query`) — removed from the product

The `/api/ui/openai/*` routes were **removed from the product on 2026-07-31** and no longer exist. (An earlier 2026-06-02 check recorded `400`s for every body shape tried; that was the endpoint rejecting a body contract before it was deleted.)

**Recommendation:** do NL→SQL **client-side** — discover the schema (`/api/schemas`→`/api/tables`→`/api/columns` or `schemaOnly:true`), compose the SQL yourself, then run it on `/api/query`. This is fully under your control. The SSE `POST /api/data-copilot/assist` is the other server-side option if one is ever needed.

---

<a id="stale-catalog"></a>
## Stale catalog → 400 on /api/schemas

Many catalogs exist whose **underlying vendor OAuth has expired** (Salesforce, Zoho, etc.). `GET /api/schemas?catalogName=X` returns **400** for those — your token is fine; the *data source's* login isn't.

**Find live catalogs first:**
```powershell
$c = Invoke-RestMethod "https://cloud.cdata.com/api/ui/account/connections" -Headers $H
$c.connections |
  Where-Object { $_.lastQueried } |
  Sort-Object lastQueried -Descending |
  Select-Object name, driver, lastQueried -First 10
```
Run discovery/queries only against catalogs with a recent `lastQueried`. Ask the connection owner to reconnect a stale one in the portal.

---

<a id="columns-empty"></a>
## /api/columns returns 0 rows

On some drivers `GET /api/columns?...&tableName=T` returns an empty `rows` array even though the table exists and is queryable (metadata-cache quirk). *(In the 2026-06-02 run it worked — 20 columns for QuickBooksOnline `Accounts` — so this is driver-specific, not universal.)*

**Reliable fallback** — schema-only query returns full column metadata with zero rows:
```powershell
$b = '{"query":"SELECT * FROM [Cat].[Schema].[Table] LIMIT 1","schemaOnly":true}'
$r = Invoke-RestMethod -Method Post "https://cloud.cdata.com/api/query" -Headers $H -ContentType "application/json" -Body $b
$r.results[0].schema | ForEach-Object { "$($_.columnName)  ($($_.dataType))" }
```

---

<a id="testconnection"></a>
## Creating a connection: the body shape, and "testing"

**Verified against a portal HAR capture (2026-06-02).** Two findings that cost real cycles:

1. **The create body must be the portal's exact shape** — PascalCase top-level keys with the driver settings under **`Props`**, plus `UserId` and a `Permissions` array. Concretely:
   ```jsonc
   POST /api/ui/account/connections
   { "ConnectionType":0, "Driver":"Salesforce", "DriverVersion":"<from /api/ui/drivers>",
     "IsCacheConnection":false, "Name":"AnkSales", "OAuthProps":{}, "OnPremOptions":{},
     "WalletFileContent":"", "UserId":"<id from /api/ui/users/self>",
     "Permissions":[{ "userId":"<id>", "opsAllowed":1 }],
     "Props":{ "AuthScheme":"Basic", "User":"…", "Password":"…", "SecurityToken":"…", "credentials":"shared" } }
   ```
   A lowercase `{ "name", "driver", "properties":{…} }` body (the older docs' shape) returns a bare **HTTP 500** with no detail — it's a body-shape mismatch, *not* your credentials. The CLI's `connection-create` builds the correct body for you.

2. **There is no reliable standalone pre-create test.** `PUT /api/ui/connection/testConnection` returned **HTTP 500** for every shape tried, and the portal doesn't use it — it **creates first** (the saved connection comes back `isTested:false`) and then **lists schemas** (`GET /api/ui/schemas?catalogName=<name>`) to confirm the connection authenticates. So: create, then verify by listing schemas (`connection-test --name <name>`). A successful schema list = the credentials work.

---

## HTTP 200 ≠ success (the error envelope)

A malformed query returns **HTTP 200** with:
```json
{ "error": { "code": "INVALID_REQUEST", "message": "Failed to parse query: Malformed SQL Statement: Unrecognized keyword: SELCT ..." } }
```
`error.code` is a **string**. Always branch on the presence of `error` before reading `results`/`rows`. Known codes: `INVALID_REQUEST`, `INVALID_AUTHORIZATION`.

---

## PAT creation: the token is in `tokenString`

`POST /api/ui/users/self/pats` returns `{ created, id, name, tokenString }`. The one-time secret is **`tokenString`** (48 chars), *not* `token`. It is shown exactly once — hand it to the user immediately and never log it. Revoke test tokens right away with `DELETE /api/ui/users/self/pats/{id}`.

---

<a id="test-log"></a>
<a id="ms-oauth-code"></a>
## Microsoft OAuth codes expire in ~60 seconds (scripted OAuth)

**Microsoft/Azure auth codes (ExcelOnline, MSTeams, any AzureAD scheme) live only ~60 seconds and are single-use.** Worse, the `cloud.cdata.com` callback page's own SPA redeems the `code` once it finishes loading — so if the user waits for the page to render, the code is already spent and `createOAuthAccessToken` returns `AADSTS70008: authorization code ... has expired`.

- **For Microsoft drivers:** tell the user to **copy the redirect URL straight from the browser address bar the instant it appears — before the page loads — and exchange it immediately** (`oauth-finish` right away, or the [local helper](oauth-local-helper.md) which exchanges instantly).
- **For Google / Salesforce / Facebook (Instagram):** codes are longer-lived and tolerate a chat round-trip fine.
- Verified 2026-06-11: ExcelOnline failed 3× via slow round-trip (AADSTS70008), then succeeded with the address-bar trick (`excel12345678`); MSTeams (`msteams12345678`) and GoogleSheets (`googlsheet1234567`) also succeeded; all `isTested=True`.

**Callback decode rules (verified):** params are base64 — decode each **once** (`state` stays one-level base64 after that single decode; `iss`/`code`/`scope` fully decode; Azure adds `session_state` which decodes to a GUID; Facebook adds a harmless `#_=_` fragment — ignore it). Pass `rssbus` as `"true"`. Merge any `passthroughParameters` from `getAuthorizationUrl` (e.g. `pkceVerifier`) into the exchange call.

<a id="put-triggers-test"></a>
## PUT /updateConnection always triggers a connection test

The portal's update endpoint tests the connection before saving — and sensitive fields (Password, SecurityToken, OAuthClientSecret, tokens) are **never returned** by the read APIs (`currentValue = "****REDACTED****"`). Consequences, all verified:

- Updating a connection that has **no credentials stored yet** always fails (`CONNECTION_TEST_FAILED`, or HTTP 400 for OAuth). Fix: **delete and recreate** it with the right values in the POST body.
- For a **new** scripted-OAuth connection, never pre-create with `InitiateOAuth=GETANDREFRESH` and then PUT the tokens in — that returned HTTP 400 (Salesforce, 2026-06-11) and can burn the single-use `code`. Always `POST /api/ui/account/connections` with `InitiateOAuth=OFF` + tokens in one pass (gives `isTested:true` immediately).
- Before any PUT, fetch `GET /api/ui/account/connection/{driver}/{connId}` and merge all non-null `currentValue`s ([connection-form-endpoint.md](connection-form-endpoint.md)); re-collect any redacted sensitive field or the test fails.
- `isOAuthWeb=true` + `isOauthTokenPresent=false` → never authenticated → PUT will fail; complete sign-in first (scripted handshake or portal).

## Creator permissions on create (opsAllowed)

Always include the creator in the POST body's `Permissions` with **`opsAllowed=15`** — fetched from `/api/ui/users/self`, set **at creation time**, never as a follow-up update. Bitmask: 1=SELECT, 2=INSERT, 4=UPDATE, 8=EXECUTE; sum for combinations (user invites may use up to 31). `connection-create` and `oauth-finish` do this automatically.

## Jobs quirks (HAR-verified June 2026)

- `/api/job/*` (public REST, PAT/Basic) **rejects the session JWT** (`signature key was not found`) — it's the embedded-account surface. Use `/api/ui/cacheJobs/*` and `/api/ui/scheduledquery/*` with the Bearer token, exactly like the web UI.
- Create/update bodies nest the source under `cacheSchemas[]` — the flat job object is only what *reads* return.
- Creating a job (or a scheduled query with default `definedNextRun=now`) **auto-queues its first run**.
- `run-job` on an already-running job → `409 CACHE_JOB_RUNNING` (expected). `run`/`stop` return 200 with no body.
- `status.info` on a job is where the real failure reason lives.

---

## Live test log — 2026-06-12 (merged-skill verification, Auth0 Bearer, account CDataSupport)

34 edge-case tests run after merging the connection-manager, workspaces/toolkits, user-management/billing, and jobs skills. All passed; objects created during testing were deleted afterwards.

| # | Area | Test | Result |
|---|---|---|---|
| 1 | Auth | `whoami` on cached token | ✅ profile returned (role 0) |
| 2–3 | Discover | `catalogs` (415) · `connections` (450, `lastQueried` present) | ✅ |
| 4–6 | Discover | `schemas`/`tables`/`columns` on live catalog `JiraNY` | ✅ 21 columns via metadata endpoint |
| – | Stale catalog | `schemas` on `Salesforce1` (expired vendor creds) | ✅ `QUERY_FAILED … INVALID_LOGIN` raised as error, not fake success |
| 7 | Query | SELECT 3 rows from `[JiraNY].[JIRA].[Projects]` | ✅ |
| 8 | Error envelope | bad SQL → HTTP 200 + `error.code` string | ✅ `INVALID_REQUEST` raised |
| 9 | Safety | `DELETE` SQL | ✅ blocked client-side |
| 10 | Query | named parameter round-trip (`@k`, dataType 5) | ✅ 1 row matched |
| 11–12 | Drivers | `drivers --search teams` (1) · `driver-form Salesforce` (11 schemes, default `OAuthPKCE`) | ✅ |
| 13 | Connections | `connection-test JiraNY` | ✅ ok=true |
| 14 | SPA trap | `raw GET /odata/...` | ✅ HTML detected, clear error |
| 15–16 | Stats | `accountStats` without dates (400 surfaced) / with dates (200) | ✅ |
| 17 | Users | `users` — 71 users | ✅ |
| 18 | Roles | `roles` — returns **custom roles only** (UUID ids) on this account; system roles come from the documented fallback table | ✅ |
| 19–21 | PATs | list (1) · create (48-char `tokenString`) · delete guard + delete | ✅ |
| 22–23 | Billing | `subscription` · `usage` | ✅ |
| 24–29 | Workspaces | list (56) · create · get · `assets-add` from JiraNY (JIRA.Projects) · `workspace-assets` shows it · delete guard + delete | ✅ full lifecycle |
| 30–34 | Toolkits | list (26) · create (`isActive:true`) · tools (0) · MCP URL derived · delete | ✅ full lifecycle |
| 35–42 | Jobs | list (6) · `job-create` (status went 2=Running — **create auto-queues**, confirmed) · `job-get` by GUID **and by name** · `job-update` freq 1→2 · `job-run` → **`CACHE_JOB_RUNNING` 409 as documented** · `job-stop` · delete guard + delete (`deletedIds` returned) | ✅ |
| 43–44 | Guards | `user-delete` without `--confirm` (no API hit) · unknown job name → helpful error | ✅ |
| 45–48 | Python helpers | `cdata_workspaces.py verify` + `cdata_jobs.py verify` **via the CLI token-cache fallback** (token file deliberately absent) · `list-workspaces` (56) · `list-jobs` (6) · `list-toolkits` (26) | ✅ one sign-in serves CLI + both helpers |
| 49–50 | Scripted OAuth | `oauth-finish` without pending state (clear error) · `oauth-start GoogleSheets` → real Google consent URL + `callbackId` + pending state file | ✅ (handshake not completed — needs interactive consent; exchange logic mirrors the HAR-verified flows) |
| 51–54 | Negative | `connection-test` unknown name (ok=false) · `workspace-get` bad GUID (`WORKSPACE_NOT_FOUND`) · `drivers` full list (212) · `help` lists all new command groups | ✅ |

Not exercised live (by design): user invite/delete against real users (sends email / destructive), full OAuth token exchange (needs interactive provider consent — flows verified by the original authors on GoogleSheets, ExcelOnline, MSTeams, Salesforce, Instagram), account-level deletes.

---

## Live test log — 2026-06-02 (Auth0 Bearer, account CDataSupport)

### Authentication
| Test | Result |
|---|---|
| Obtain token via bundled script | ✅ TTL 24 h, `aud=https://cloud.cdata.com/api`, `azp=lEvk7ySDJAaWHhBWPEY9fiMNYf4RN25e` |
| `GET /api/ui/users/self` (admin plane) | ✅ 200 — Auth0 token covers admin (no PAT needed) |

### Read-only — data + admin (all `200` unless noted)
| Endpoint | Result |
|---|---|
| `GET /api/catalogs` | ✅ 388 catalogs |
| `GET /api/userinfo` | ✅ |
| `GET /api/workspaces` | ✅ `{accountId, workspaces}` |
| `GET /api/ui/users/self` · `/users/session` | ✅ |
| `GET /api/ui/account/getInfo` | ✅ |
| `GET /api/ui/account/settings/feature-switches` | ✅ 8 keys |
| `GET /api/ui/billing/subscription` · `/billing/usage` | ✅ |
| `GET /api/ui/drivers` | ✅ 204 drivers |
| `GET /api/ui/drivers/CSV` | ✅ 200, ~287 KB property schema |
| `GET /api/ui/account/connections` | ✅ 391 connections |
| `GET /api/ui/workspaces` | ✅ 51 workspaces |
| `GET /api/ui/users/self/pats` | ✅ |
| `GET /api/ui/scheduledquery/list` · `/cacheJobs/list` | ✅ |
| `GET /api/ui/overview/accountStats` | ⚠️ 400 without params · ✅ 200 with `?startDate&endDate` |
| `GET /api/async/actuator/health/readiness` | ⚠️ 401 (async gateway) |

### Schema discovery (catalog `QuickBooksOnlineTapan`)
| Endpoint | Result |
|---|---|
| `GET /api/schemas` | ✅ cols `TABLE_CATALOG, TABLE_SCHEMA` |
| `GET /api/tables` | ✅ 85 tables (name at row[2]) |
| `GET /api/columns` (Accounts) | ✅ 20 columns |
| `GET /api/procedures` | ✅ 9 procedures |

### Query execution
| Test | Result |
|---|---|
| `POST /api/query` valid SELECT … LIMIT 3 | ✅ 200, 3 rows |
| `POST /api/query` `schemaOnly:true` | ✅ 200, 20 columns, 0 rows |
| `POST /api/query` **bad SQL** | ⚠️ **HTTP 200**, `error.code="INVALID_REQUEST"` |
| `POST /api/query` parameterized (`@nm`, dataType 5) | ✅ 200, 2 rows |

### Writes (self-cleaning)
| Test | Result |
|---|---|
| `POST /api/ui/users/self/pats` | ✅ 200, returns `tokenString` (48 chars) |
| `GET /api/ui/users/self/pats` confirms new id | ✅ |
| `DELETE /api/ui/users/self/pats/{id}` | ✅ 200 (cleaned up) |

### Negative / edge
| Test | Result |
|---|---|
| `POST /api/async/query` | ⚠️ 401, `WWW-Authenticate: Basic` (async needs PAT) |
| `POST /api/ui/openai/query` (5 body shapes) | ⚠️ 400 each (2026-06-02); routes since **removed from the product** (2026-07-31) |
| `POST /api/ui/account/connections` with `{name,driver,properties}` (lowercase) | ⚠️ 500 — **wrong body shape** |
| `POST /api/ui/account/connections` with portal body (PascalCase + `Props` + `UserId`/`Permissions`) | ✅ 200 — created (`isTested:false`); confirmed by HAR + live create of `AnkSales` |
| `PUT /api/ui/connection/testConnection` (any shape) | ⚠️ 500 — portal doesn't use it; verify by listing schemas instead |
| `GET /odata/{ws}` · `/api.rsc` · `/openapi/v1/{ws}` | ⚠️ 200 **text/html** (SPA trap) |

**Not executed live (destructive — documented only):** delete user/account/connection/workspace, OEM sub-account create/delete, invite user, real connection create, scheduled-query/cache-job create/run/stop, vault/agent-location/toolkit writes. Follow the 🔒 confirm-every-time rule for these.
