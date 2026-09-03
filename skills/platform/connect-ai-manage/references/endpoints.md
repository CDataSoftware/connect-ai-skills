# Full endpoint catalog

117 endpoints across the CData Connect AI surface, grouped by domain. Source: *Connect AI API Coverage Matrix* (May 2026) reconciled with live verification on 2026-06-02.

**Auth for every endpoint in this skill: `Authorization: Bearer <Auth0 token>`.** (The matrix lists per-endpoint schemes like "PAT/Basic"; this skill ignores those and uses the single Auth0 token everywhere — it works on both planes.)

**Legend:** ✅ verified live (2026-06-02) · ⚠️ verified with a caveat (see [edge-cases.md](edge-cases.md)) · 🔒 destructive — confirm with user every time · 🚫 blocked by this skill.

Base URL: `https://cloud.cdata.com`.

---

## Data plane — `/api/*`

### Schema discovery
| ✓ | Method | Path | Purpose |
|---|---|---|---|
| ✅ | GET | `/api/catalogs` | List catalogs (connections) |
| ✅ | GET | `/api/schemas` | List schemas in a catalog |
| ✅ | GET | `/api/tables` | List tables/views |
| ✅ | GET | `/api/columns` | List columns *(see [columns-empty](edge-cases.md#columns-empty))* |
| ✅ | GET | `/api/procedures` | List stored procedures |
|   | GET | `/api/procedureParameters` | Inspect procedure params |
|   | GET | `/api/primaryKeys` | Primary keys |
|   | GET | `/api/importedKeys` | Foreign keys (this table → parents) |
|   | GET | `/api/exportedKeys` | Tables referencing this one |
|   | GET | `/api/indexes` | Index metadata |

### Query execution
| ✓ | Method | Path | Purpose |
|---|---|---|---|
| ✅ | POST | `/api/query` | One SELECT / INSERT / UPDATE (full SQL-92) |
|   | POST | `/api/batch` | Many-row INSERT/UPDATE (🚫 DELETE blocked) |
|   | POST | `/api/exec` | Execute stored procedure |

### Connections (data-plane REST)
| ✓ | Method | Path | Purpose |
|---|---|---|---|
|   | GET | `/api/connections` | List connections |
|   | POST | `/api/connections` | Create connection |
|   | PUT | `/api/connections/{id}` | Update connection |
| 🔒 | DELETE | `/api/connections/{id}` | Delete connection |
|   | POST | `/api/connections/{id}/metadata/clear` | Clear cached metadata |

> Prefer the admin-plane connection endpoints (`/api/ui/account/connections`, below) — they return far richer detail. Create uses a PascalCase body with driver settings under `Props` (see [edge-cases.md](edge-cases.md#testconnection)).

### Jobs
| ✓ | Method | Path |
|---|---|---|
|   | GET | `/api/jobs` · `/api/jobs/{id}` |
|   | POST | `/api/jobs` · `/api/jobs/{id}/run` · `/api/jobs/{id}/stop` |
|   | PUT | `/api/jobs/{id}` |
| 🔒 | DELETE | `/api/jobs/{id}` |

### Logs & audit
| ✓ | Method | Path | Purpose |
|---|---|---|---|
|   | POST | `/api/log/query/list` | Search query logs |
|   | GET | `/api/log/query/get/{queryId}` | Download a query log |
|   | POST | `/api/log/audit/list` | Search audit logs |

### Misc data plane
| ✓ | Method | Path | Purpose |
|---|---|---|---|
| ✅ | GET | `/api/workspaces` | List workspaces (`{accountId, workspaces}`) |
| ✅ | GET | `/api/userinfo` | Authenticated user info |
|   | POST | `/api/cache` | Manage cache connection |
|   | POST | `/api/mcp` | MCP server endpoint (agent integration) |

### OEM sub-accounts
| ✓ | Method | Path |
|---|---|---|
|   | GET | `/api/accounts` · POST `/api/accounts` |
| 🔒 | DELETE | `/api/accounts/{id}` |

### OData & OpenAPI ⚠️
| ✓ | Method | Path | Purpose |
|---|---|---|---|
| ⚠️ | GET | `/odata/{serviceName}` | OData service doc |
| ⚠️ | GET | `/odata/{serviceName}/$metadata` | EDMX metadata |
| ⚠️ | * | `/odata/{serviceName}/{resourcePath}` | OData CRUD |
| ⚠️ | GET | `/openapi/{version}/{workspaceName}` | OpenAPI spec |

> ⚠️ **SPA-routing trap (verified):** these paths returned the website's HTML (`<!doctype html>`, HTTP 200), not OData/JSON, for a plain workspace name + Bearer token. Treat any HTML reply as "this surface isn't reachable that way" and use `/api/query` (SQL) instead. Details: [edge-cases.md](edge-cases.md#spa-trap).

### Async queries 🚫 (not usable with Auth0)
| ✓ | Method | Path |
|---|---|---|
| ⚠️ | POST | `/api/async/query` |
| ⚠️ | GET | `/api/async/query/{queryId}` |
| 🔒 | DELETE | `/api/async/query/{queryId}` |
| ⚠️ | GET | `/api/async/query/{queryId}/results/{pageNumber}` |
| ⚠️ | GET | `/api/async/actuator/health/readiness` |

> ⚠️ **Verified:** the async gateway answered `401` with `WWW-Authenticate: Basic` to an Auth0 Bearer token — it wants PAT/Basic, which this skill doesn't use. **Async is effectively unavailable here.** For long-running queries, raise `timeout` on `/api/query`. See [edge-cases.md](edge-cases.md#async).

---

## Admin plane — `/api/ui/*` (Auth0 Bearer; verified to work)

### Account & session
| ✓ | Method | Path | Purpose |
|---|---|---|---|
| ✅ | GET | `/api/ui/account/getInfo` | Account name, owner, plan |
|   | PUT | `/api/ui/account/organization` | Update org info |
| ✅ | GET | `/api/ui/account/settings/feature-switches` | Feature flags (~8 keys) |
| 🔒 | DELETE | `/api/ui/account/delete` | Delete account (highly destructive) |
|   | POST | `/api/ui/account/loginAccount` | Session bootstrap (needs JWT first) |
|   | POST | `/api/ui/account/loginAccountSSO` | SSO session bootstrap |
|   | POST | `/api/ui/account/createInvitedUser` | Complete signup from invite |
| ✅ | GET | `/api/ui/users/self` | Current user profile (the verify call) |
| ✅ | GET | `/api/ui/users/session` | Aggregated session info |

### Users & roles
| ✓ | Method | Path | Purpose |
|---|---|---|---|
| ✅ | GET | `/api/ui/users` | List all users |
| ✅ | GET | `/api/ui/users/{userId}` | One user (fetch before PUT) |
| ✅ | GET | `/api/ui/roles` | All roles — integer id = system, UUID = custom ([flows](user-management-billing.md)) |
| ✅ | POST | `/api/ui/user/inviteNewUserList` | Invite a user — the portal's invite path (body: `email`, `role` int, `customRoleIds[]`, `permissions[{connectionId,opsAllowed}]`, `workspacePermissions[]`) |
|   | POST | `/api/ui/users/invite` | (older path; the portal uses `inviteNewUserList`) |
| ✅ | PUT | `/api/ui/users/{userId}` | Edit a user — GET first, merge, PUT the full object |
| 🔒 | DELETE | `/api/ui/users/{userId}` | Delete user/invite |

### Personal Access Tokens (management only)
| ✓ | Method | Path | Purpose |
|---|---|---|---|
| ✅ | GET | `/api/ui/users/self/pats` | List own PATs |
| ✅ | POST | `/api/ui/users/self/pats` | Create PAT — token returned once in **`tokenString`** |
| ✅ | DELETE | `/api/ui/users/self/pats/{patId}` | Revoke |

> The skill authenticates with Auth0, never a PAT — but it can still *mint* PATs for the user's other tools on request. Response keys: `created, id, name, tokenString` (the 48-char token shown once).

### Connections (admin plane — richer than data-plane)
| ✓ | Method | Path | Purpose |
|---|---|---|---|
| ✅ | GET | `/api/ui/account/connections` | List all, full detail (`lastQueried`, `authScheme`, …) |
| ✅ | GET | `/api/ui/account/connections/{connectionId}` | One connection's config |
|   | GET | `/api/ui/account/connection/{driverName}/{connectionId}` | Bind to driver form |
|   | POST | `/api/ui/account/connections` | Create connection |
|   | PUT | `/api/ui/account/updateConnection` | Update connection |
| ⚠️ | PUT | `/api/ui/connection/testConnection` | **Returned 500 for all shapes; the portal doesn't use it** — verify a connection by listing schemas instead ([detail](edge-cases.md#testconnection)) |
| 🔒 | DELETE | `/api/ui/account/connections/{connectionId}` | Delete connection |

### Drivers
| ✓ | Method | Path | Purpose |
|---|---|---|---|
| ✅ | GET | `/api/ui/drivers` | List all (~204). Item keys: `driver, niceName, category, beta, premium, version, hidden, …` |
| ✅ | GET | `/api/ui/drivers/{driver}` | Full property schema (large JSON — connection form) |
|   | POST | `/api/ui/drivers/{driver}/dynamicPropValues` | Live values (e.g. list Salesforce orgs) |

### Workspaces & assets
| ✓ | Method | Path | Purpose |
|---|---|---|---|
| ✅ | GET | `/api/ui/workspaces` | List (keys `id,name,description,childCount`) |
| ✅ | POST | `/api/ui/workspaces` | Create (body: `{name}`) |
| ✅ | GET | `/api/ui/workspaces/{workspaceId}` | Metadata + asset count |
| ✅ | GET | `/api/ui/workspaces/{workspaceId}/children` | The actual assets (alias, source schema.table, type, driver) |
| 🔒 | DELETE | `/api/ui/workspaces/{workspaceId}` | Delete |
| ✅ | POST | `/api/ui/workspaces/{id}/assets/fromConnection/batch` | Add assets (body: `{Records:[{AssetType:1, ConnectionId, DataAssetCategory:1, ParentId:null, SchemaName, TableName}]}` — what the UI sends) |
|   | POST | `/api/ui/workspaces/{id}/assets/fromConnection` | Single-asset variant |

### AI / NL-to-SQL ⚠️ (removed from the product)
The `/api/ui/openai/*` routes were **removed from the product on 2026-07-31** — they no longer exist. (The 2026-06-02 finding recorded `400`s against `/api/ui/openai/query`; those were a real endpoint rejecting a body shape, before the routes were deleted.) Do NL→SQL **client-side** instead ([detail](edge-cases.md#nl-sql)).

| ✓ | Method | Path | Purpose |
|---|---|---|---|
| 🚫 | POST | `/api/ui/openai/query` | NL→SQL — **removed from the product (2026-07-31)** |
| 🚫 | POST | `/api/ui/openai/tokens` | Token counter — **removed from the product (2026-07-31)** |

### Billing & overview
| ✓ | Method | Path | Purpose |
|---|---|---|---|
| ✅ | GET | `/api/ui/billing/subscription` | Plan + limits |
| ✅ | GET | `/api/ui/billing/usage` | Current usage |
| ⚠️ | GET | `/api/ui/overview/accountStats` | **needs `?startDate=&endDate=`** or 400 |
|   | GET | `/api/ui/overview/queriesOverTime` | Query volume over time |

### Jobs — scheduled queries (HAR-verified June 2026; see [jobs.md](jobs.md))
| ✓ | Method | Path | Purpose |
|---|---|---|---|
| ✅ | GET | `/api/ui/scheduledquery/list` | List (`{accountId, list:[…]}`) |
| ✅ | GET | `/api/ui/scheduledquery/{id}` | One scheduled query |
| ✅ | POST | `/api/ui/scheduledquery/create` | Create (body: `name, query, destinationConnection/Schema/Table, destinationWriteScheme, jobFrequency(+Unit), enabled, logVerbosity, definedNextRun`) |
| 🔒 | DELETE | `/api/ui/scheduledquery/deleteBatch` | Delete (body: `{ids:[…]}`) |

### Jobs — cache jobs (HAR-verified June 2026; see [jobs.md](jobs.md))
| ✓ | Method | Path | Purpose |
|---|---|---|---|
| ✅ | GET | `/api/ui/cacheJobs/list` | List (`{accountId, list:[…]}`) |
| ✅ | GET | `/api/ui/cacheJobs/{id}` | One job (`status.info` = real failure reason) |
| ✅ | POST | `/api/ui/cacheJobs` | Create (body nests source under `cacheSchemas[]`) |
| ✅ | PUT | `/api/ui/cacheJobs/jobs/update` | Update (same shape + top-level `verbosity`; `cacheSchemas[]` entries carry `id` + `enabled`) |
| ✅ | POST | `/api/ui/cacheJobs/run/{id}` | Run now (409 `CACHE_JOB_RUNNING` if already running) |
| ✅ | PUT | `/api/ui/cacheJobs/stop/{id}` | Stop |
| 🔒 | DELETE | `/api/ui/cacheJobs/deleteBatch` | Delete (body: `{ids:[…]}`) |

> ⚠️ The public `/api/job/*` surface (PAT/Basic) is the **embedded-account** API — it rejects the session JWT (`signature key was not found`). The web UI itself uses the `/api/ui/cacheJobs/*` paths above with the Bearer token.

### OAuth handshake (BFF — powers the portal "Sign In" button; see [oauth-without-portal.md](oauth-without-portal.md))
| ✓ | Method | Path | Purpose |
|---|---|---|---|
| ✅ | POST | `/api/ui/oauth/getAuthorizationUrl` | Provider consent URL + `callbackId` (+ optional `passthroughParameters`, e.g. `pkceVerifier`) |
| ✅ | POST | `/api/ui/oauth/createOAuthAccessToken` | Exchange the callback `code` → `oauthaccesstoken` + `oauthrefreshtoken` (callback params are base64 — decode each once) |

### Toolkits & tools (Data Copilot; see [workspaces-toolkits.md](workspaces-toolkits.md))
| ✓ | Method | Path | Purpose |
|---|---|---|---|
| ✅ | GET | `/api/ui/toolkits` | List (embeds each toolkit's `tools`) |
| ✅ | GET | `/api/ui/toolkits/{id}/tools` | Tool records — 2 per data source (`universal` + `source`) |
| ✅ | POST | `/api/ui/toolkits` | Create (body: `{name}`; returns `isActive:true`) |
|   | POST | `/api/ui/toolkits/{id}/tools` | Create tool (payload not yet pinned down) |
|   | PATCH | `/api/ui/toolkits/{toolkitId}/activate` | Activate (payload not yet pinned down) |
| 🔒 | DELETE | `/api/ui/toolkits/{toolkitId}` | Delete |

> Every toolkit is an MCP server at `https://mcp.cloud.cdata.com/mcp/toolkits/{id}` — auth there is HTTP Basic `base64(username:PAT)`, **not** the Bearer JWT.

### Agent locations (on-prem connectivity)
| ✓ | Method | Path | Purpose |
|---|---|---|---|
|   | GET | `/api/ui/agent-locations` | List |
|   | POST | `/api/ui/agent-locations` | Create |
|   | POST | `/api/ui/agent-locations/{locationId}/keys` | Create key (shown once) |

### Vault & custom OAuth apps
| ✓ | Method | Path |
|---|---|---|
|   | GET | `/api/ui/vaultConfigurations` · POST `/api/ui/vaultConfigurations` |
|   | GET | `/api/ui/customOAuthApps/list` |

### OEM admin
| ✓ | Method | Path |
|---|---|---|
|   | GET | `/api/ui/api/poweredby/account/list` |
|   | POST | `/api/ui/api/poweredby/account/create` |
| 🔒 | DELETE | `/api/ui/api/poweredby/account/delete/{subAccountId}` |

---

## Data Copilot — `/api/data-copilot/*` (Auth0 Bearer; SSE)

| ✓ | Method | Path | Purpose |
|---|---|---|---|
|   | POST | `/api/data-copilot/assist` | NL chat (Server-Sent Events stream) |
|   | POST | `/api/data-copilot/assist/memory` | Cached response |
|   | POST | `/api/data-copilot/prompt-summary` | Summarize a long prompt |
|   | POST | `/api/data-copilot/conversations` | Create thread |
|   | GET | `/api/data-copilot/conversations` · `/api/data-copilot/conversations/{id}` | List / get |
|   | PUT | `/api/data-copilot/conversations/{id}` | Update |
| 🔒 | DELETE | `/api/data-copilot/conversations/{id}` | Delete |

> `/assist` streams SSE — read events until the stream closes. For most "answer a question about my data" needs, client-side NL→SQL (discover schema → write SQL → `/api/query`) is simpler and more controllable.

---

## Partner gateway — `/partner/public/*`

Uses partner-specific Basic auth (a separate credential, **not** the Auth0 token). Out of scope for normal use; listed for completeness.

| Method | Path |
|---|---|
| POST | `/partner/public/cdata/connect` |
| POST | `/partner/public/snowflake/connect` |
| POST | `/partner/public/databricks/connect` · `/partner/public/databricks/test-connection` |
| GET | `/partner/public/databricks/connectors` |
| DELETE | `/partner/public/databricks/delete-connection` |

---

## Quick card — the 20 you'll actually use

| Do this | Call |
|---|---|
| Verify sign-in | `GET /api/ui/users/self` |
| List data sources | `GET /api/catalogs` |
| List schemas / tables / columns | `GET /api/schemas` · `/api/tables` · `/api/columns` |
| Run a read query | `POST /api/query` |
| Insert / update | `POST /api/query` (one) · `/api/batch` (many) |
| Run a procedure | `POST /api/exec` |
| List connections (rich) | `GET /api/ui/account/connections` |
| List drivers / driver form | `GET /api/ui/drivers` · `/api/ui/drivers/{driver}` |
| Verify a connection | `GET /api/ui/schemas?catalogName=N` (create then list schemas) |
| Create a connection | `POST /api/ui/account/connections` |
| Workspaces / publish tables | `GET\|POST /api/ui/workspaces` · `POST /api/ui/workspaces/{id}/assets/fromConnection` |
| Users / invite | `GET /api/ui/users` · `POST /api/ui/user/inviteNewUserList` |
| Mint a PAT | `POST /api/ui/users/self/pats` |
| Account / billing | `GET /api/ui/account/getInfo` · `/api/ui/billing/subscription` |
| DELETE anything | 🚫 gated — confirm with user, or refuse for data |
