# Authentication — token & sign-in, in depth

This skill talks to the **data plane** (`/api/*`) only, and authenticates one of two ways, **by surface** (see SKILL.md Step 0):

- **Path A — Claude Code (a shell is available):** an **Auth0-issued JWT** used as `Authorization: Bearer <token>`, obtained by the bundled CLI's browser sign-in and cached + refreshed silently.
- **Path B — Claude Chat (shell-less):** a **Personal Access Token (PAT)** used as HTTP Basic auth, `Authorization: Basic base64(email:PAT)`.

Both authorize `/api/*`. This skill does **not** touch the admin plane (`/api/ui/*`) — that's `connect-ai-manage`, which is Auth0-only (a PAT is rejected there with `401 INVALID_AUTHORIZATION`; see below).

> **Why a PAT on shell-less surfaces (not a scraped Auth0 token)?** A host that can't run a process can't perform the CLI's browser OAuth handshake, so it needs a credential the user can hand over. A **PAT is the right one**: it's purpose-built to give to tools, individually revocable, and the data plane accepts it via Basic auth. **Do not** scrape a live Auth0 Bearer token out of browser DevTools — that puts a full-scope session token into the chat. (On a shell, Path A avoids pasting anything at all.)

---

## Path A token, in one paragraph

You sign in through your organization's normal login (Microsoft / SSO → Auth0 universal login → MFA, all handled by the browser). Auth0 returns a short-lived **access token** (JWT, ~24 h) and a long-lived **refresh token**. The CLI puts the access token on every request; when it nears expiry, the refresh token gets a new one silently. You only see a browser the very first time (and again only if the refresh token is ever revoked). The claims below describe this Path A access token (a PAT is an opaque string, not a JWT):

| Claim | Value (PROD) |
|---|---|
| Issuer (`iss`) | `https://cloud-login.cdata.com/` |
| Audience (`aud`) | `https://cloud.cdata.com/api` |
| Authorizing party (`azp`) | `lEvk7ySDJAaWHhBWPEY9fiMNYf4RN25e` (embedded driver OAuth client) |
| Algorithm | RS256 |
| TTL | 86,400 s (24 h) |
| Scope | `openid profile email offline_access` (`offline_access` yields the refresh token) |

---

## Which path for which environment (ties to SKILL.md Step 0)

The deciding factor is **whether the host can run a process**:

| Environment | Bucket | How to authenticate | Then call `/api/*` via |
|---|---|---|---|
| **Claude Code** — also terminals, code-interpreter, CI, agent runtimes | can run a process | **Path A** — browser sign-in via the CLI (`connect-cli.mjs login`) | the CLI subcommands, or `curl` / `Invoke-RestMethod` / `requests` with the Auth0 Bearer token |
| **Claude Chat** — Claude.ai, Claude Desktop, with a fetch/HTTP tool | can't run a process | **Path B** — a **PAT** the user creates and pastes | the host's HTTP tool with `Authorization: Basic base64(email:PAT)` |
| **Claude Chat** — no shell *and* no HTTP tool, but the user can run commands | assisted | **Path B** (or the user runs the CLI) | the user runs the calls and pastes results back |
| **Can't connect** — restricted network, no shell/HTTP, user can't run it | — | — | report that connecting isn't possible here; **do not** use a present MCP connector unless the user explicitly says to |

This skill never uses a pre-wired MCP connector to obtain or carry the credential — see SKILL.md ground rule 2. The rest of this document details Path A (Claude Code) and Path B (Claude Chat).

## Path A — Claude Code: browser sign-in (automated)

In the **Claude Code** bucket the primary tool is the cross-platform CLI — `node scripts/connect-cli.mjs login` (then `status` / `whoami`). It opens the browser once, then caches and silently refreshes the token.

The PowerShell helper `scripts/cdata-connect-auth.ps1` (Windows) does the same OAuth dance but just *returns a Bearer token* for raw-REST scripting. The CLI and the script share one token cache, so a single sign-in serves both.

```powershell
$tok = & "<skill-dir>\scripts\cdata-connect-auth.ps1"
$H   = @{ Authorization = "Bearer $tok"; Accept = "application/json" }
Invoke-RestMethod "https://cloud.cdata.com/api/catalogs" -Headers $H   # data-plane smoke test → 200
```

Behavior:
- **Cache hit** (token >5 min from expiry) → returns it instantly, no network.
- **Cache stale but refresh token present** → silent refresh, no browser.
- **No cache / refresh failed** → opens the browser to Auth0, listens on `http://localhost:33333` (loopback only), captures the code, exchanges it, caches the result.

Cache location: `%LOCALAPPDATA%\CData\connect-auth.json` (in the user profile). It holds `access_token`, `refresh_token`, `expires_at` as **plaintext JSON — no DPAPI/keychain protection**, so treat the file as sensitive (it carries a long-lived refresh token). **The skill never copies this file's contents into any skill file.**

Useful switches: `-Force` (skip cache, full browser flow), `-Port <n>` (change the listener port), `-TimeoutSeconds <n>` (sign-in wait, default 300).

### How the script works (bounce-server flow)

The embedded driver OAuth client is registered with the redirect `https://oauth.cdata.com/oauth/` (a CData-hosted "bounce" server), **not** `localhost`. The script works around that:

1. Build the authorize URL with `state = base64("http://localhost:33333")` and `redirect_uri = https://oauth.cdata.com/oauth/`:
   ```
   https://cloud-login.cdata.com/authorize
     ?audience=https://cloud.cdata.com/api
     &scope=offline_access
     &state=<base64(http://localhost:33333)>
     &client_id=<driver client id>
     &response_type=code
     &redirect_uri=https://oauth.cdata.com/oauth/
   ```
2. Auth0 redirects to the bounce server, which **decodes `state`** and forwards to `http://localhost:33333?code=<base64(realCode)>&rssbus=true`.
3. The local listener catches it. The `code` is **base64-encoded** — the script decodes it first.
4. Token exchange at `https://cloud-login.cdata.com/oauth/token` with `grant_type=authorization_code`, the decoded `code`, the client id/secret, and `redirect_uri=https://oauth.cdata.com/oauth/` (must match the registered redirect, **not** localhost).
5. Refresh later: `grant_type=refresh_token` with the stored refresh token.

The driver client id/secret are shipped **encrypted** in the driver (AES-128-ECB, PKCS7, key = ASCII `"_rssbus_"` right-padded to 16 bytes). The script decrypts them at runtime to drive the flow. *(Source of truth: `ProviderCDataConnect/src/.../QueryUtil.java`, `OAuthBase.java`, `OAuthConsts.java`.)*

---

<a id="path-b"></a>
## Path B — Claude Chat (shell-less): PAT + Basic auth

**Why a PAT here:** a host that can't run a process can't open a browser callback or listen on `localhost`, so it can't perform the CLI's OAuth handshake. A **Personal Access Token** is the credential to use — it's purpose-built to hand to tools, individually revocable, works on any OS with nothing installed, and the data plane (`/api/*`) accepts it via Basic auth. Do **not** scrape a live Auth0 Bearer token from DevTools.

**Treat the PAT as a password:** hold it in session memory only, never write it into a skill file, and don't echo it back into the conversation.

1. In the Connect AI console, go to **Settings → Personal Access Tokens → Create PAT**, name it, **Create**, and copy it (shown once).
2. Build the header: `Authorization: Basic base64(email:PAT)` — Base64 of `your-email:the-PAT` (keep the colon).
3. Use it on `/api/*` calls. It does **not** expire in 24 h like the Auth0 token; revoke it in the console when done.

Verify the PAT with a **data-plane** call:

```
GET https://cloud.cdata.com/api/catalogs
Authorization: Basic base64(email:PAT)
```

A `200` means it's good. A `401` on `/api/*` means the PAT is wrong or revoked (re-create it). A `401` specifically on any `/api/ui/*` call is **expected** — the admin plane doesn't accept PATs; that surface belongs to `connect-ai-manage`, which uses the CLI/Auth0 path.

---

## Verifying the session

| Check | Call | Pass |
|---|---|---|
| Data plane (this skill) | `GET /api/catalogs` | 200 + `results[0].rows` |

A `200` on `/api/catalogs` confirms the credential works for this skill's data operations. The admin plane (`/api/ui/*`) is out of scope here — use `connect-ai-manage` for that.

---

## When the credential fails

| Situation | What you'll see | Do |
|---|---|---|
| Auth0 token expired (>24 h), Path A | `401` on any call | Just re-run the CLI — it auto-refreshes (or `login --from-scratch`). |
| Refresh token revoked, Path A | CLI falls back to the browser automatically | Complete the browser sign-in once. |
| PAT wrong / revoked, Path B | `401` on `/api/*` | Re-create the PAT (Settings → Personal Access Tokens) and re-paste. |
| PAT used against the admin plane | `401 INVALID_AUTHORIZATION` on `/api/ui/*` | **Expected** — this skill only uses `/api/*`. Admin work is `connect-ai-manage` (CLI/Auth0). |
| MFA / step-up required (Path A) | Handled inside the browser sign-in | Nothing — complete it in the browser. The skill never sees MFA codes. |

---

## Non-production environments (rarely needed)

The driver recognizes other Auth0 tenants by `ServerVersion`. Only relevant if your Connect AI host isn't `cloud.cdata.com`:

| Env | Authorize / token host (Path A) | API base |
|---|---|---|
| PROD | `cloud-login.cdata.com` | `https://cloud.cdata.com/api` |
| STAGE | `cdata-connect-staging.us.auth0.com` | `https://staging.clouddataos.com/api` |
| DEV | `cdata-connect-dev.us.auth0.com` | `https://dev.clouddataos.com/api` |

Replace `https://cloud.cdata.com` with the matching API base everywhere; a PAT (Path B) is created in that host's console. The default skill targets PROD.

---

## What is never persisted

PATs, OAuth access tokens, refresh tokens, OAuth client secrets, Basic-Auth passwords — **none** are written by this skill. A **PAT pasted in the Claude Chat bucket** lives in session memory only — never written to a file, never echoed back. The Path A Auth0 tokens live only in the CLI's local cache (see above), never in the chat.
