---
name: connect-ai-manage
description: Administer the CData Connect AI platform itself (cloud.cdata.com) — NOT for querying data. Use to create/update/test/delete connections, inspect drivers and their connection forms, run scripted OAuth sign-in without the portal, manage workspaces & data assets, manage toolkits (incl. registering one as an MCP server), manage jobs (cache jobs & scheduled queries), manage users/roles/invites, mint or revoke Personal Access Tokens, and check subscription/usage/billing. Trigger on "create a connection", "test my Salesforce connection", "list drivers", "publish a workspace", "register a toolkit as an MCP server", "schedule a query", "cache this table", "invite a user", "mint a PAT", "check our usage/subscription", or any admin operation against cloud.cdata.com. For reading or writing DATA in a connected source, do not use this skill — use connect-ai-base (+ the connector skill) over MCP, or connect-ai-direct over the raw API when no MCP connector is present.
license: MIT
metadata:
  author: CData Software
  version: '1.0.0'
  homepage: https://www.cdata.com/connect/
  auth: Auth0 JWT (Bearer) only
---

# CData Connect AI — Manage the Platform

This skill administers the **CData Connect AI platform** ([cloud.cdata.com](https://cloud.cdata.com)) through its `/api/ui/*` admin API. It does **not** query or write data in your connected sources — see the routing below.

Everything runs under an **Auth0 Bearer token** obtained from your normal company sign-in. The admin plane (`/api/ui/*`) accepts *only* Auth0 — Personal Access Tokens are rejected there with `401` — which is why this skill is Auth0-only.

## Where this skill sits (routing)

| The user wants to… | Use |
|---|---|
| **Administer the platform** (connections, drivers, workspaces, toolkits, jobs, users, PATs, billing) | **this skill** |
| Read/write **data** in a source, with an MCP connector present | `connect-ai-base` + the connector skill (`connect-ai-<source>`) |
| Read/write **data** with **no** MCP connector available | `connect-ai-direct` |
| Set Connect AI up in Claude Code for the first time | `connect-ai-onboarding-claude-code` |

On Claude Code, this skill and `connect-ai-direct` share the same Auth0 CLI sign-in and token cache, so moving between admin and direct-API data work needs no re-auth. (On shell-less surfaces, `connect-ai-direct` uses a PAT instead — and admin isn't available there; see Step 0.)

## Ground rules

1. **Never connect on activation.** Loading this skill produces no banner, no sign-in, no menu. Act only when the user makes a concrete admin request — and then preflight (Step 0) first.
2. **Auth0 only — never the MCP connector.** Even if a Connect AI MCP connector is present in the session, this skill signs in fresh with Auth0 so you operate under the user's full account scope. Honor "use my MCP connector" only if the user explicitly types it.
3. **Everything goes through Connect AI.** This skill never calls a vendor API directly.
4. **Destructive actions are gated.** Deleting connections/workspaces/toolkits/jobs/users, revoking PATs, or deleting the account require explicit per-action confirmation — echo back exactly what will be removed, and never chain them. All destructive CLI commands require `--confirm`.
5. **An HTML reply means the wrong door.** A response of `<!doctype html>` instead of JSON means you hit a browser route (`/odata`, `/api.rsc`, `/openapi`). Use the `/api/ui/*` JSON endpoints.

## Step 0 — Preflight (run only on a real request)

Confirm there's an active Connect AI session before doing the task; running admin calls against a dead session just fails halfway.

- **Claude Code (shell available):** `node scripts/connect-cli.mjs status` (silent — never opens a browser).
  - `"status":"active"` → go to Step 2.
  - `"no-session"` / `"session-invalid"` → do Step 1, then re-run `status`.
- **Claude Chat (no shell):** **admin is not supported here.** The admin plane (`/api/ui/*`) requires an Auth0 token, which can only be obtained via the CLI's browser sign-in — and PATs are rejected on `/api/ui/*`. Tell the user to run this skill from Claude Code (or any surface with a shell). Do **not** work around it by scraping an Auth0 token from browser DevTools. (Data queries with no shell are still possible — that's the `connect-ai-direct` skill, via a PAT.)

Run the preflight once at the start; repeat only if a later call returns `401`.

## Step 1 — Sign in (Auth0, via the CLI)

Admin requires an **Auth0 Bearer token**, obtained through the CLI's browser sign-in. There is **no** shell-less path for admin (see Step 0). The bundled Node CLI does the OAuth dance and caches + silently refreshes for 24h:

```bash
node scripts/connect-cli.mjs login     # opens the browser once; caches + auto-refreshes
node scripts/connect-cli.mjs whoami     # verify — proves admin access
```

- First run opens your normal CData/Microsoft sign-in; the CLI catches the callback on `http://localhost:33333`.
- Later runs use the cached token. Reset with `login --from-scratch`.
- The token stays in the local CLI cache and never enters the chat. **Never** scrape an Auth0 token from browser DevTools to work around a shell-less surface — if there's no shell, admin isn't available here.

## Step 2 — Admin operations

Admin lives under `https://cloud.cdata.com/api/ui/*`. Run the CLI command — or, if you prefer raw HTTP, issue the REST call directly using the CLI-obtained Auth0 token (e.g. via an HTTP tool on the same shell host; the token comes from Step 1's `login`). Full catalog: [references/endpoints.md](references/endpoints.md).

| Goal | CLI command | REST |
|---|---|---|
| List connections (full detail) | `connections` | `GET /api/ui/account/connections` |
| List installed drivers (~200) | `drivers [--search X]` | `GET /api/ui/drivers` |
| Distill a driver's connection form | `driver-form --driver D` | `GET /api/ui/drivers/{driver}` |
| Verify a connection (lists its schemas) | `connection-test --name N` | `GET /api/ui/schemas?catalogName=N` |
| Create a connection (then verifies) | `connection-create --name N --driver D --props '…'` | `POST /api/ui/account/connections` |
| Guided create/update/permissions/secure credential collection | flows in [connection-manager.md](references/connection-manager.md) | `PUT /api/ui/account/updateConnection`, … |
| OAuth sign-in without the portal | `oauth-start` → `oauth-finish` | `POST /api/ui/oauth/getAuthorizationUrl` → `createOAuthAccessToken` |
| Delete a connection (needs `--confirm`) | `connection-delete --id ID --confirm` | `DELETE /api/ui/account/connections/{id}` |
| Workspaces: list/create/assets/publish | `workspaces`, `workspace-create`, `workspace-assets`, `assets-add` | `GET/POST /api/ui/workspaces…` |
| Toolkits: list/create/tools/MCP URL | `toolkits`, `toolkit-create`, `toolkit-tools`, `toolkit-url` | `GET/POST /api/ui/toolkits…` |
| Jobs: list/get/create/run/stop/update/delete | `jobs`, `job-get`, `job-create`, `scheduled-query-create`, `job-run`, `job-stop`, `job-update`, `job-delete` | `/api/ui/cacheJobs/*`, `/api/ui/scheduledquery/*` |
| Users & roles: list/invite/edit/delete | `users`, `roles`, `user-invite`, `user-update`, `user-delete` | `GET /api/ui/users`, `POST /api/ui/user/inviteNewUserList`, … |
| PATs: list/mint/revoke | `pats`, `pat-create`, `pat-delete` | `/api/ui/users/self/pats` |
| Billing: subscription/usage | `subscription`, `usage` | `/api/ui/billing/*` |
| Anything else | `raw --method … --path /api/ui/…` | see [endpoints.md](references/endpoints.md) |

**Golden rule for creating a connection** (verified against the portal's own create flow): `driver-form --driver D` (learn auth schemes + required props) → `connection-create` (the CLI builds the portal's exact PascalCase body — driver settings under `Props`, plus `UserId` and a `Permissions` entry — saves it, then verifies by listing schemas). There is **no** reliable standalone pre-create test endpoint; a lowercase `{properties:…}` body returns HTTP 500. For the top ~30 sources, ready-made settings are in [connection-recipes.md](references/connection-recipes.md); any other driver, use `driver-form`.

## Safety rails

- **Destructive admin** (`DELETE /api/ui/users/{id}`, `DELETE /api/ui/account/delete`, deleting connections/workspaces/toolkits/jobs, revoking PATs): confirm explicitly every time, echo back exactly what will be removed, never chain. All destructive CLI commands require `--confirm`.
- **Credentials never travel through chat.** Passwords, security tokens, client secrets, and API keys are collected via the local HTML form on the user's machine ([connection-manager.md](references/connection-manager.md)); OAuth codes/tokens from the scripted handshake stay in session memory and are never echoed.
- **Permissions are the user's, not elevated.** A `403` means the user lacks rights — surface it; don't work around it.
- **HTML response = wrong door** (ground rule 5).

## Error recovery (quick reference)

| Symptom | Meaning | Fix |
|---|---|---|
| `401` on `/api/ui/*` | Token missing/expired (24h), or a PAT was used (rejected here) | Re-run `login` (auto-refresh) or `login --from-scratch`. Admin needs an Auth0 token from the CLI — PATs don't work on `/api/ui/*` |
| `500` on create connection | Wrong body (must be PascalCase + `Props` + `UserId`/`Permissions`) | Use `connection-create` (builds the right body) — [edge-cases.md](references/edge-cases.md) |
| `403` | User lacks permission (RBAC) | Surface it; ask an admin to grant access |
| `<!doctype html>` | Wrong path (SPA route) | Use `/api/ui/*` JSON endpoints |
| `AADSTS70008` on OAuth exchange | MS codes expire in ~60s (single-use) | Copy the address-bar URL instantly; run `oauth-finish` immediately |
| `CONNECTION_TEST_FAILED` on update | PUT always tests; secrets aren't returned | Delete & recreate, or re-collect credentials |
| `409 CACHE_JOB_RUNNING` | Job already running | Expected — wait or `job-stop` first |
| `400` on `/api/ui/overview/accountStats` | Missing date range | Add `?startDate=&endDate=` |

## Reference

Deep detail loads only when needed:

- [references/cli.md](references/cli.md) — the CLI: every command + auth
- [references/endpoints.md](references/endpoints.md) — full `/api/ui/*` catalog
- [references/authentication.md](references/authentication.md) — sign-in + token internals (shared with `connect-ai-direct`)
- [references/connection-manager.md](references/connection-manager.md) — guided connection CRUD, permissions, credential forms
- [references/connection-recipes.md](references/connection-recipes.md) — ready-made settings for the top ~30 sources
- [references/connection-form-endpoint.md](references/connection-form-endpoint.md) — the connection edit-form endpoint
- [references/oauth-without-portal.md](references/oauth-without-portal.md) — scripted OAuth handshake
- [references/workspaces-toolkits.md](references/workspaces-toolkits.md) — workspaces, assets, MCP registration
- [references/jobs.md](references/jobs.md) — cache jobs & scheduled queries
- [references/user-management-billing.md](references/user-management-billing.md) — users, roles, PATs, billing
- [references/edge-cases.md](references/edge-cases.md) — verified error → fix playbook

## Security & privacy

- All traffic is HTTPS to your Connect AI host; no vendor API is called directly.
- Auth0 access/refresh tokens live in the CLI's local token cache (`%LOCALAPPDATA%\CData\connect-auth.json`) and session memory only — never in the chat, never written to skill files. Note the cache is plaintext JSON in the user profile (no DPAPI/keychain), so treat it as sensitive; only the non-secret host URL is otherwise remembered.
- Connect AI enforces the signed-in user's permissions; `403`s are surfaced, not bypassed.
- Destructive actions are gated (see Safety rails).
