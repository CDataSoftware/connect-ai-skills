# The Connect AI CLI (`connect-cli.mjs`)

The skill's **primary tool** — the Connect AI analogue of the Membrane CLI. It owns Auth0 sign-in (browser once, then silent refresh) and wraps the whole REST surface as subcommands, so you issue clean commands instead of hand-building HTTP. Bundled at [`scripts/connect-cli.mjs`](../scripts/connect-cli.mjs).

- **Runtime:** Node 18+ (zero dependencies — Node built-ins only). Verified on Node 25.
- **Auth:** Auth0 only (embedded driver OAuth client + `oauth.cdata.com` bounce server). No PAT. Token cached at `%LOCALAPPDATA%\CData\connect-auth.json` (Windows) or `~/.config/CData/connect-auth.json`, shared with the PowerShell helper.
- **Output:** JSON on stdout. Errors are `{"error":"…"}` on stdout with exit code 1. Sign-in progress prints to stderr.
- **Invocation:** `node scripts/connect-cli.mjs <command> [options]`. (Publishable later as `@cdata/connect-cli` for `npx @cdata/connect-cli <command>` with no code change.)

```bash
node scripts/connect-cli.mjs login          # browser once, then cached + auto-refreshed
node scripts/connect-cli.mjs catalogs
node scripts/connect-cli.mjs query "SELECT [Id],[Name] FROM [Cat].[Schema].[Table] LIMIT 10"
```

---

## Command reference

### Auth
| Command | Purpose |
|---|---|
| `status` / `preflight` | **Run this first.** Checks for an *active Connect AI connection* **silently** — uses the cached token or a silent refresh, but **never opens a browser**. Returns `status: active \| no-session \| session-invalid`, the signed-in user, `connectionCount`, and the 5 most `recentlyUsed` connections. The skill's preflight step (SKILL.md Step 0) before any task. |
| `login [--from-scratch] [--port N]` | Sign in via Auth0. Uses cached token if valid, silently refreshes if expiring, else opens the browser once. `--from-scratch` wipes the cache and forces a fresh browser login. |
| `logout` | Delete the cached token. |
| `whoami` | Show the signed-in user — verifies **both** data and admin access in one call. |

> **`status` vs `login`:** `status` only *reports* (never opens a browser), so it's safe as an always-first preflight. If it returns `no-session`/`session-invalid`, run `login` to establish or refresh the session, then re-run `status`.

### Discover & query
| Command | Purpose |
|---|---|
| `catalogs` | List data-source connections (catalogs). |
| `schemas --catalog C` | List schemas in a catalog. |
| `tables --catalog C --schema S [--table T]` | List tables/views. |
| `columns --catalog C --schema S --table T` | List columns. Auto-falls back to a `schemaOnly` query if the metadata endpoint returns 0 rows. |
| `query "<SQL>" [--catalog C] [--schema S] [--params '<json>'] [--schema-only]` | Run a SELECT/INSERT/UPDATE. Returns rows as objects. DELETE is blocked. |
| `exec --procedure Cat.Schema.Proc [--schema S] [--params '<json>']` | Execute a stored procedure. |

`--params` is a JSON object of `@name → {dataType, value}` (and `direction` for `exec`). Data-type codes and direction codes: see [operations.md](operations.md). Example:
```bash
node scripts/connect-cli.mjs query "SELECT [Id] FROM [Cat].[S].[Case] WHERE [Status]=@s" \
  --params '{"@s":{"dataType":5,"value":"Open"}}'
```

### Admin
| Command | Purpose |
|---|---|
| `connections` | List all connections (id, name, driver, lastQueried, isTested, authScheme). |
| `drivers [--search term]` | List installed drivers, optionally filtered. |
| `driver-form --driver D [--auth-scheme S]` | Distill a driver's connection form → auth schemes, required props, credential props, and an edit-and-test template. |
| `connection-test --name N` | Verify an **existing** connection by listing its schemas (the way the portal "tests" — a standalone pre-create test isn't reliable headlessly). |
| `connection-create --name N --driver D --props '<json>' [--no-verify]` | Create the connection, then verify it by listing schemas (unless `--no-verify`). The CLI builds the portal's exact body for you (PascalCase, driver settings under `Props`, plus `UserId`/`Permissions`); you only pass the driver props. |
| `connection-delete --id ID --confirm` | Delete a connection. Requires `--confirm` (destructive). |

### Scripted OAuth (no portal)
| Command | Purpose |
|---|---|
| `oauth-start --driver D --name N [--props '<json>']` | BFF handshake step 1: returns the provider consent URL + `callbackId`, stashes the pending state. Full flow + per-provider decode rules: [oauth-without-portal.md](oauth-without-portal.md). |
| `oauth-finish --url "<callback URL>" [--props '<json>']` | Decodes the callback params (each base64, decoded once; `rssbus` → `"true"`), exchanges the code, creates the connection with `InitiateOAuth=OFF` + stored tokens (creator `opsAllowed=15`), verifies by listing schemas. Tokens are never echoed. **Microsoft drivers: run this within ~60 s of approval** ([why](edge-cases.md#ms-oauth-code)). |

### Users, roles & PATs
| Command | Purpose |
|---|---|
| `users` | List all users. |
| `roles` | List roles — integer id = system role, UUID = custom role ([flows](user-management-billing.md)). |
| `user-invite --email E --role N [--custom-role-ids '<json>'] [--permissions '<json>']` | Send an invite (`POST /api/ui/user/inviteNewUserList`). Use the guided flow in [user-management-billing.md](user-management-billing.md#3--invite-a-new-user-guided-step-by-step) to collect the inputs. |
| `user-update --id ID --set '<json>'` | GET-merge-PUT — pass only the changed fields in `--set`. |
| `user-delete --id ID --confirm` | Delete a user/invite (destructive). |
| `pats` | List own PATs (mask values when presenting). |
| `pat-create --name N` | Create a PAT — full token in `tokenString`, shown once. |
| `pat-delete --id ID --confirm` | Revoke a PAT (destructive). |

### Billing
| Command | Purpose |
|---|---|
| `subscription` | Plan, status, billing cycle (warn if expiring within 7 days). |
| `usage` | Current usage stats (rich widget template: [user-management-billing.md](user-management-billing.md#8--usage-statistics-rich-widget)). |

### Workspaces & assets
| Command | Purpose |
|---|---|
| `workspaces` | List workspaces (`id`, `name`, `childCount`). |
| `workspace-create --name N` · `workspace-get --id ID` | Create / fetch one. |
| `workspace-assets --id ID` | List a workspace's assets (the `/children` endpoint — `get` only returns the count). |
| `workspace-delete --id ID --confirm` | Delete (destructive). |
| `assets-add --workspace-id ID --connection-id ID --schema S --tables T1,T2` | Publish tables from a connection (batch). Guided multi-step flow: [workspaces-toolkits.md](workspaces-toolkits.md). |

### Toolkits
| Command | Purpose |
|---|---|
| `toolkits` · `toolkit-create --name N` · `toolkit-tools --id ID` | List / create / list tools. Each data source = 2 backend records (universal + source) — see [workspaces-toolkits.md](workspaces-toolkits.md). |
| `toolkit-delete --id ID --confirm` | Delete (destructive). |
| `toolkit-url --id ID` | The toolkit's MCP URL (`https://mcp.cloud.cdata.com/mcp/toolkits/{id}`). MCP auth = HTTP Basic `base64(username:PAT)`, **not** the Bearer JWT. The Python helper's `mcp-command` assembles `claude mcp add` for you. |

### Jobs (cache jobs + scheduled queries)
| Command | Purpose |
|---|---|
| `jobs` | Merged list of caching jobs + scheduled queries (each tagged `_kind`). |
| `job-get --id ID_OR_NAME` | Full job JSON — `status.info` holds the real failure reason. |
| `job-create --source-connection GUID --source-schema S --source-table T --frequency N --frequency-unit U [...]` | Create a cache job (body nests under `cacheSchemas`; `--body` for exact JSON / multi-table). Auto-queues its first run. |
| `scheduled-query-create --name N --query SQL --destination-connection GUID --destination-schema S --destination-table T --frequency N --frequency-unit U [...]` | Create a scheduled query (defaults: write-scheme 1, enabled, verbosity 2, next-run now). |
| `job-update --id ID_OR_NAME [flags]` | Fetches the current cache job, overlays only your flags, PUTs. Scheduled queries: use `--body`. |
| `job-run --id` · `job-stop --id` | Queue / stop. `409 CACHE_JOB_RUNNING` on run = already running (expected). |
| `job-delete --id ID_OR_NAME --confirm` | Routes to the right `deleteBatch` endpoint by kind (destructive). |

`--frequency-unit` codes (best-effort): 1=Minute, 2=Hour, 3=Day, 4=Week, 5=Month. `--id` accepts a GUID or the exact job name.

> The bundled **Python helpers** `scripts/cdata_workspaces.py` and `scripts/cdata_jobs.py` cover the same ground with richer output (grouped tool views, `claude mcp add --run`, table formatting) — see [workspaces-toolkits.md](workspaces-toolkits.md) and [jobs.md](jobs.md). They share the CLI's token cache, so one `login` serves all three. (Windows: if `python` isn't on PATH, use `py`.)

### Escape hatch
| Command | Purpose |
|---|---|
| `raw --method M --path /api/... [--body '<json>'] [--query '<json>']` | Call any endpoint not yet wrapped. `DELETE` requires `--confirm`. Use this for the long tail in [endpoints.md](endpoints.md). |

### Global flags
| Flag | Effect |
|---|---|
| `--compact` | Single-line JSON (good for piping to `jq`). |
| `--host URL` | Override the API base (default `https://cloud.cdata.com`) for non-prod environments. |
| `--help` / `help` | Usage. |

---

## What the CLI handles for you

- **Auth lifecycle** — cached token, silent refresh, `--from-scratch` reset. You never paste a token.
- **The HTTP-200 error envelope** — a failed query returns HTTP 200 with `{"error":{code,message}}`; the CLI raises it as a real error instead of handing you a fake success. (`error.code` is a string like `INVALID_REQUEST`.)
- **SPA-routing trap** — if a path returns HTML instead of JSON, the CLI raises a clear error telling you to use an `/api/*` endpoint.
- **Safety rails** — `query` blocks DELETE; `connection-delete`/`raw DELETE` require `--confirm`; `connection-create` verifies the new connection by listing its schemas.
- **Driver-form distillation** — turns the 100–300 KB driver schema into the few fields you actually need, with a ready template.

## When the CLI can't run

The CLI needs a host that can run a Node process — the **Claude Code** bucket (also terminals, CI, agent runtimes). In the **Claude Chat** bucket (e.g. Claude.ai, Claude Desktop), fall back to:
- **paste a Bearer token** and call the REST endpoints in [operations.md](operations.md) / [endpoints.md](endpoints.md) with the host's HTTP tool, or
- have the **user run these same CLI commands** on their machine and paste results back.

See SKILL.md Step 0. The CLI never uses a pre-wired MCP connector (ground rule 2).

---

## Productionizing (optional, "at our end")

The file is already structured as a publishable package. To ship it as `npx @cdata/connect-cli`:
1. Add a `package.json` with `{ "name": "@cdata/connect-cli", "type": "module", "bin": { "connect-cli": "./connect-cli.mjs" } }`.
2. `npm publish --access public` under the CData org.
3. The skill then calls `npx -y @cdata/connect-cli <command>` instead of `node scripts/connect-cli.mjs <command>` — identical behavior, zero code change. This is exactly how `@membranehq/cli` is consumed.
