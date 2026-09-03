# The Connect AI CLI (`connect-cli.mjs`) — data commands

The skill's **primary tool** on a shell — the Connect AI analogue of the Membrane CLI. It owns Auth0 sign-in (browser once, then silent refresh) and wraps the REST surface as subcommands, so you issue clean commands instead of hand-building HTTP. Bundled at [`scripts/connect-cli.mjs`](../scripts/connect-cli.mjs).

This page documents the **auth + data-plane** commands this skill uses. The same CLI binary also has admin commands (connections, drivers, users, workspaces, toolkits, jobs, PATs, billing, scripted OAuth) — those are documented in the **`connect-ai-manage`** skill, not here.

- **Runtime:** Node 18+ (zero dependencies — Node built-ins only). Verified on Node 25.
- **Auth:** the CLI signs in with **Auth0** (embedded driver OAuth client + `oauth.cdata.com` bounce server); the token is cached at `%LOCALAPPDATA%\CData\connect-auth.json` (Windows) or `~/.config/CData/connect-auth.json`, shared with the PowerShell helper. The CLI itself doesn't use a PAT — on shell-less surfaces the skill uses a **PAT + Basic auth without the CLI** (raw `/api/*` calls; see [authentication.md](authentication.md#path-b)).
- **Output:** JSON on stdout. Errors are `{"error":"…"}` on stdout with exit code 1. Sign-in progress prints to stderr.
- **Invocation:** `node scripts/connect-cli.mjs <command> [options]`.

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
| `whoami` | Show the signed-in user — verifies the credential works. |

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

### Global flags
| Flag | Effect |
|---|---|
| `--compact` | Single-line JSON (good for piping to `jq`). |
| `--host URL` | Override the API base (default `https://cloud.cdata.com`) for non-prod environments. |
| `--help` / `help` | Usage. |

---

## What the CLI handles for you

- **Auth lifecycle** — cached token, silent refresh, `--from-scratch` reset. You never paste a token on this path.
- **The HTTP-200 error envelope** — a failed query returns HTTP 200 with `{"error":{code,message}}`; the CLI raises it as a real error instead of handing you a fake success. (`error.code` is a string like `INVALID_REQUEST`.)
- **SPA-routing trap** — if a path returns HTML instead of JSON, the CLI raises a clear error telling you to use an `/api/*` endpoint.
- **Safety rail** — `query` blocks `DELETE` SQL.

## When the CLI can't run

The CLI needs a host that can run a Node process — the **Claude Code** bucket (also terminals, CI, agent runtimes). In the **Claude Chat** bucket (e.g. Claude.ai, Claude Desktop), fall back to:
- **use a PAT** with `Authorization: Basic base64(email:PAT)` and call the `/api/*` endpoints in [operations.md](operations.md) with the host's HTTP tool (see [authentication.md](authentication.md#path-b)), or
- have the **user run these same CLI commands** on their machine and paste results back.

See SKILL.md Step 0. The CLI never uses a pre-wired MCP connector (ground rule 2).

---

## Productionizing (optional, "at our end")

The file is already structured as a publishable package. To ship it as `npx @cdata/connect-cli`:
1. Add a `package.json` with `{ "name": "@cdata/connect-cli", "type": "module", "bin": { "connect-cli": "./connect-cli.mjs" } }`.
2. `npm publish --access public` under the CData org.
3. The skill then calls `npx -y @cdata/connect-cli <command>` instead of `node scripts/connect-cli.mjs <command>` — identical behavior, zero code change.
