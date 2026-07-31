---
name: connect-ai-direct
description: Query and write data through CData Connect AI over its raw REST API (cloud.cdata.com/api/*) — the fallback path for when NO Connect AI MCP connector is available in the session (e.g. Claude Chat, or a Claude Code session where the connector was never registered). Use to read data ("how many open Salesforce cases?", "list HubSpot contacts"), insert/update rows, or run stored procedures against any connected source via SQL over HTTP. IMPORTANT — when a Connect AI MCP connector IS present, do NOT use this skill: prefer connect-ai-base plus the connector skill (connect-ai-<source>), which get richer per-driver guidance this path cannot. For platform administration (connections, users, jobs, workspaces, toolkits, PATs, billing), use connect-ai-manage.
license: MIT
metadata:
  author: CData Software
  version: '1.0.0'
  homepage: https://www.cdata.com/connect/
  auth: Auth0 JWT (Bearer) via the CLI; PAT (Basic auth) on shell-less surfaces
---

# CData Connect AI — Direct API (no-MCP data path)

This skill reads and writes data through Connect AI's **raw REST API** (`https://cloud.cdata.com/api/*`) — authenticating with an **Auth0 Bearer token** via the CLI (Claude Code) or a **PAT** (shell-less surfaces; see Step 1). It exists for surfaces where the **MCP connector is not available**. It is deliberately the *thinner* data path — see the limitation below.

## When to use this skill (and when not to)

**Use it only when there is no MCP connector.** If the session has Connect AI MCP tools (`getCatalogs`, `queryData`, or toolkit `*_query_data`), stop and use the MCP path instead — it's better.

| Situation | Use |
|---|---|
| MCP connector present, want data | `connect-ai-base` + connector skill (`connect-ai-<source>`) — **preferred** |
| **No** MCP connector, want data | **this skill** |
| Platform administration | `connect-ai-manage` |
| First-time setup in Claude Code | `connect-ai-onboarding-claude-code` |

> **How to check:** if `tool_search` finds `getCatalogs`/`queryData` (or `*_query_data`), an MCP connector exists → hand off to `connect-ai-base`. Only proceed here when that search comes back empty.

## Key limitation — no per-driver guidance

The MCP path exposes `getInstructions`, which supplies driver-specific hints (quoting rules, SQL-dialect quirks, required scope params, known-unsupported operations). **The raw REST API has no `getInstructions` equivalent.** So on this path you work **discovery-first** — you infer structure from `/api/tables` and `/api/columns` and compose generic SQL-92 — without those hints. This is why the MCP path is preferred whenever a connector is available, and why this skill does **not** reference the connector skills (they are written for the MCP transport).

## Ground rules

1. **Never connect on activation.** No banner, no sign-in until the user makes a concrete data request — then preflight (Step 0) first.
2. **Never use the MCP connector.** If an MCP connector is present you shouldn't be in this skill at all (see above). For auth: on a shell (Claude Code) use a fresh **Auth0 Bearer** token via the CLI; on a shell-less surface (Claude Chat) use a **PAT with Basic auth** — the data plane (`/api/*`) accepts it, and a PAT is safer to paste than a live session token (purpose-built, revocable). Do **not** scrape an Auth0 token from browser DevTools.
3. **Everything goes through Connect AI.** Never call a vendor API directly.
4. **No deletes.** This skill will not run `DELETE` SQL. Prefer a soft delete (`UPDATE … SET Status='Archived'`) or have the user run it from the portal SQL console.
5. **An HTML reply means the wrong door.** `<!doctype html>` instead of JSON means a browser route (`/odata`, `/api.rsc`, `/openapi`) — use the `/api/*` JSON endpoints.

## Step 0 — Preflight (run only on a real request)

1. **Confirm no MCP connector** (`tool_search` for `getCatalogs`/`queryData` returns nothing). If one exists → use `connect-ai-base` instead.
2. **Confirm an active session:**
   - Claude Code: `node scripts/connect-cli.mjs status` (silent).
   - Claude Chat: verify a held PAT with a **data-plane** call — `GET /api/catalogs` (200 = active). Do **not** verify against `/api/ui/*`; the admin plane rejects PATs with `401`.
   If not active, do Step 1.

## Step 1 — Sign in

Two credentials, by surface. Both authorize the data plane (`/api/*`).

### Step 1A — Claude Code: browser sign-in (preferred)

Uses the CLI's Auth0 browser flow — the token is cached locally and never enters the chat:

```bash
node scripts/connect-cli.mjs login     # browser once; caches + auto-refreshes 24h
node scripts/connect-cli.mjs whoami      # verify
```

### Step 1B — Claude Chat (shell-less): PAT + Basic auth

There's no local process to run the browser flow, so use a **Personal Access Token** — a PAT is purpose-built to hand to tools and is individually revocable, so it's the right credential to paste (never scrape a live Auth0 token from DevTools).

1. The user creates a PAT in the Connect AI console (**Settings → Personal Access Tokens → Create PAT**) and copies it.
2. Requests use HTTP Basic auth: `Authorization: Basic base64(email:PAT)`.
3. Verify with a **data-plane** call: `GET /api/catalogs` (200 = good).

Handle the PAT like a password — never echo it back. `401` on `/api/*` means it's wrong or revoked; `401` specifically on any `/api/ui/*` call is expected (the admin plane doesn't accept PATs — that surface belongs to `connect-ai-manage`, which needs the CLI).

> The user pastes the PAT into chat only because a shell-less surface has no local terminal. If a terminal *is* available, prefer Step 1A (nothing sensitive enters the session).

## Step 2 — Operate on data

All calls use `https://cloud.cdata.com/api/*`. Auth header depends on the surface (Step 1): **Claude Code** → the CLI sends `Authorization: Bearer <Auth0 token>` for you; **Claude Chat** → send `Authorization: Basic base64(email:PAT)`. Each source is a **catalog** → **schemas** → **tables/views** → **columns**. In Claude Code run the CLI; in Claude Chat issue the HTTP request directly.

### 2a. Discover

**Claude Code (CLI):**
```bash
node scripts/connect-cli.mjs catalogs
node scripts/connect-cli.mjs schemas --catalog Salesforce1
node scripts/connect-cli.mjs tables  --catalog Salesforce1 --schema Salesforce
node scripts/connect-cli.mjs columns --catalog Salesforce1 --schema Salesforce --table Case
```

**Claude Chat (raw HTTP):**
```
GET /api/catalogs
GET /api/schemas?catalogName=Salesforce1
GET /api/tables?catalogName=Salesforce1&schemaName=Salesforce
GET /api/columns?catalogName=Salesforce1&schemaName=Salesforce&tableName=Case
```

> **If `/api/columns` returns zero rows** for a table that clearly exists (a known driver metadata-cache quirk), get columns from a schema-only query instead — `POST /api/query` with `"schemaOnly": true`. See [edge-cases.md](references/edge-cases.md#columns-empty).

**Which catalog?** A catalog whose connection has a recent `lastQueried` is healthy; one whose vendor OAuth expired returns **400** on `/api/schemas` (that's the source's login, not yours).

### 2b. Query (read)

Use **fully-qualified, bracketed** names and **named parameters** for any user value — never concatenate values into SQL.

**Claude Code (CLI):**
```bash
node scripts/connect-cli.mjs query \
  "SELECT [Id],[CaseNumber],[Subject],[Status] FROM [Salesforce1].[Salesforce].[Case] WHERE [Status]=@status ORDER BY [CreatedDate] DESC LIMIT 25" \
  --params '{"@status":{"dataType":5,"value":"Open"}}'   # 5 = VARCHAR
```

**Claude Chat (raw HTTP):** `POST /api/query` with `{ "query": "…", "parameters": { "@status": { "dataType": 5, "value": "Open" } } }`.

> **#1 gotcha (verified):** a failed query still returns **HTTP 200**, with the error in the body and `error.code` as a **string**, not `0`:
> ```jsonc
> // success:            { "results": [ { "schema": [...], "rows": [...] } ] }   // no "error"
> // failure (HTTP 200): { "error": { "code": "INVALID_REQUEST", "message": "..." } }
> ```
> Check `error` before trusting `rows`. (The CLI does this for you.)

### 2c. Write (insert / update / procedure)

Check columns (2a) first to avoid read-only fields.

**Claude Code (CLI):**
```bash
# INSERT
node scripts/connect-cli.mjs query \
  "INSERT INTO [HubSpot1].[HubSpot].[Contacts] ([Email],[FirstName]) VALUES (@e,@f)" \
  --params '{"@e":{"dataType":5,"value":"a@b.com"},"@f":{"dataType":5,"value":"Ada"}}'

# UPDATE — always scope with WHERE
node scripts/connect-cli.mjs query \
  "UPDATE [Salesforce1].[Salesforce].[Case] SET [Status]=@s WHERE [Id]=@id" \
  --params '{"@s":{"dataType":5,"value":"Closed"},"@id":{"dataType":5,"value":"5001x..."}}'

# STORED PROCEDURE
node scripts/connect-cli.mjs exec --procedure Cat.Schema.MyProc \
  --params '{"@In":{"direction":1,"dataType":5,"value":"x"},"@Out":{"direction":4,"dataType":5,"value":null}}'
```

**Claude Chat (raw HTTP):** `POST /api/query` (single), `/api/batch` (many rows), `/api/exec` (procedures). Parameter `direction` codes (1=IN, 2=INOUT, 4=OUT, 5=RETURN) and data-type codes (1=BINARY … 5=VARCHAR … 18=UUID) are in [operations.md](references/operations.md). **DELETE is blocked** either way.

> **`affectedRows: 0`?** Your `WHERE` matched nothing, or you tried to write a read-only column. Re-check with 2a.

> **Plain-English requests:** discover the schema (2a), compose SQL yourself, then run 2b/2c. Do NL→SQL client-side — the portal's server-side NL→SQL endpoint isn't a stable contract.

## Safety rails

- **DELETE (data):** blocked. Offer a soft delete or tell the user to run it from the portal SQL console.
- **Parameterize user values.** Bind every user value as a parameter (`@name` + `dataType`); never concatenate into SQL.
- **Connection credentials never travel through chat.** Passwords, security tokens, and API keys for the underlying sources are set in the Connect AI console, not here. The one credential that may enter the session is the user's **PAT on a shell-less surface** (Step 1B) — unavoidable there, which is why a revocable PAT is used rather than a live Auth0 token; treat it like a password and never echo it.
- **Permissions are the user's.** A `403` means the user lacks rights — surface it.
- **Async queries: don't rely on them.** The async gateway (`/api/async/*`) rejects Auth0 (`401`), so it's unavailable on the Claude Code path. For long queries, raise `timeout` on `/api/query`.

## Error recovery (quick reference)

| Symptom | Meaning | Fix |
|---|---|---|
| `401` on `/api/*` | Credential missing / expired / revoked | Claude Code: `login` (auto-refresh). Claude Chat: check the PAT is correct and not revoked; re-create if needed (Step 1B) |
| HTTP 200 but `error.code` set | Query failed (string code) | Read `error.message`; fix SQL/params |
| `400` on `/api/schemas?catalogName=X` | That source's vendor OAuth expired | Pick a catalog with recent `lastQueried`; ask owner to reconnect |
| `/api/columns` returns 0 rows | Driver metadata-cache quirk | Use `POST /api/query` with `schemaOnly:true` |
| `affectedRows: 0` | `WHERE` matched nothing / read-only column | Verify with `/api/columns` |
| `<!doctype html>` | Wrong path (SPA route) | Use `/api/*` JSON endpoints |
| `403` | User lacks permission (RBAC) | Surface it |

## Reference

- [references/cli.md](references/cli.md) — the CLI: every data command + auth
- [references/operations.md](references/operations.md) — request/response bodies, SQL rules, data-type codes
- [references/examples.md](references/examples.md) — worked examples (PowerShell, curl, Python)
- [references/authentication.md](references/authentication.md) — sign-in + token internals (shared with `connect-ai-manage`)
- [references/edge-cases.md](references/edge-cases.md) — verified error → fix playbook

## Security & privacy

- All traffic is HTTPS to your Connect AI host; no vendor API is called directly.
- On Claude Code, the Auth0 token lives in the local CLI cache and session memory only — never in the chat, never written to skill files. On a shell-less surface, the user's PAT enters the session (unavoidable there); it is revocable and should be treated like a password.
- Every user value is bound as a parameter; values are never concatenated into SQL.
- DELETE is blocked; `403`s are surfaced, not bypassed.
