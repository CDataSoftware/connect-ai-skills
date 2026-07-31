# Authentication — Auth0 JWT (Bearer), in depth

This skill authenticates with **exactly one** mechanism: an **Auth0-issued JWT** used as `Authorization: Bearer <token>`. There is no PAT path, no Basic-auth path, no API-key path. The single Auth0 token reaches **both** the data plane (`/api/*`) and the admin plane (`/api/ui/*`) — verified live (see [edge-cases.md](edge-cases.md#test-log)).

> **Why Auth0-only?** A PAT (Basic auth) is *rejected with HTTP 401 `INVALID_AUTHORIZATION` on `/api/ui/*`* — it cannot drive the admin plane at all. A single Auth0 token covers everything, refreshes silently, and keeps one consistent identity. So this skill standardizes on it and never asks for a PAT.

---

## The token, in one paragraph

You sign in through your organization's normal login (Microsoft / SSO → Auth0 universal login → MFA, all handled by the browser). Auth0 returns a short-lived **access token** (JWT, ~24 h) and a long-lived **refresh token**. The skill puts the access token on every request. When it nears expiry, the refresh token gets a new one silently. You only see a browser the very first time (and again only if the refresh token is ever revoked).

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

The deciding factor is **whether the host can run a process**, which splits every host into two buckets:

| Environment | Bucket | How to get the token | Then call the API via |
|---|---|---|---|
| **Claude Code** — also terminals, code-interpreter, CI, agent runtimes | can run a process | **Path A** — browser sign-in via the CLI (`connect-cli.mjs login`) | the CLI subcommands, or `curl` / `Invoke-RestMethod` / `requests` |
| **Claude Chat** — Claude.ai, Claude Desktop, with a fetch/HTTP tool | can't run a process | **Path B** — paste the Bearer token from the browser | the host's HTTP tool with `Authorization: Bearer <token>` |
| **Claude Chat** — no shell *and* no HTTP tool, but the user can run commands | assisted | **Path B** — the user captures it (or runs the CLI) | the user runs the calls and pastes results back |
| **Can't connect** — restricted network, no shell/HTTP, user can't run it | — | — | report that fresh sign-in isn't possible here; **do not** use a present MCP connector unless the user explicitly says to |

Every usable path uses the fresh Auth0 token described here. This skill never uses a pre-wired MCP connector to obtain or carry the token — see SKILL.md ground rule 2. The rest of this document details Path A (Claude Code) and Path B (Claude Chat).

## Path A — Claude Code: browser sign-in (automated)

In the **Claude Code** bucket the primary tool is the cross-platform CLI — `node scripts/connect-cli.mjs login` (then `status` / `whoami`). It opens the browser once, then caches and silently refreshes the token. Everything below about the OAuth flow applies to it.

The PowerShell helper `scripts/cdata-connect-auth.ps1` (Windows) does the same OAuth dance but just *returns a Bearer token* for raw-REST scripting. The CLI and the script share one token cache, so a single sign-in serves both.

```powershell
$tok = & "<skill-dir>\scripts\cdata-connect-auth.ps1"
$H   = @{ Authorization = "Bearer $tok"; Accept = "application/json" }
Invoke-RestMethod "https://cloud.cdata.com/api/ui/users/self" -Headers $H   # smoke test → 200
```

Behavior:
- **Cache hit** (token >5 min from expiry) → returns it instantly, no network.
- **Cache stale but refresh token present** → silent refresh, no browser.
- **No cache / refresh failed** → opens the browser to Auth0, listens on `http://localhost:33333`, captures the code, exchanges it, caches the result.

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
## Path B — Claude Chat: manual token capture (any OS, any LLM host)

**Why a Bearer token in the Claude Chat bucket:** a host that can't run a process can't open a browser callback or listen on `localhost`, so it can't perform the interactive OAuth handshake the CLI uses. The token your signed-in browser *already holds* is the way in — and the Auth0 Bearer token is the one credential that drives **both** the data plane (`/api/*`) and the admin plane (`/api/ui/*`). A Personal Access Token can't substitute: it's rejected with `401 INVALID_AUTHORIZATION` on `/api/ui/*` (see [edge-cases.md](edge-cases.md#test-log)). So Claude Chat captures the Bearer token straight from the browser — it works on any OS, needs nothing installed, and is independent of OAuth callback configuration.

**Treat the token as a secret:** hold it in session memory only, never write it into a skill file, and don't echo it back into the conversation.

1. Open **`https://cloud.cdata.com`** and sign in (you'll see your normal Microsoft/SSO page; Auth0 is invisible behind it).
2. **DevTools → Network** (F12). Reload, or click anything that triggers a request.
3. Click any request whose URL contains **`/api/ui/`** (e.g. `/api/ui/users/session`).
4. In **Request Headers**, find `authorization: Bearer eyJ…` and copy the **entire** value (~1,500+ chars).
5. Paste it to the assistant. It's used as `Authorization: Bearer <token>` for ~24 h.

No refresh token comes with this path — when the 24 h token expires, repeat. Nothing is written to any skill file.

### Validate a pasted JWT before trusting it

```powershell
$jwt = "<pasted>"
$p = $jwt.Split('.')[1].Replace('-','+').Replace('_','/'); while($p.Length%4){$p+='='}
$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json
"iss=$($payload.iss)  aud=$($payload.aud)"
$ttl = $payload.exp - [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
"TTL = $([int]($ttl/3600)) h"   # negative ⇒ already expired, re-capture
```

Expect `iss = https://cloud-login.cdata.com/` and `aud = https://cloud.cdata.com/api`. (Via Path B — Claude Chat — `azp` will be the website's SPA client id rather than the driver client — both are accepted by the API.)

---

## Verifying the session

| Check | Call | Pass |
|---|---|---|
| Data plane | `GET /api/catalogs` | 200 + `results[0].rows` |
| Admin plane | `GET /api/ui/users/self` | 200 + your profile |

A 200 on `/api/ui/users/self` proves the token works for **everything** — you don't need to test more.

---

## When the token fails

| Situation | What you'll see | Do |
|---|---|---|
| Expired (>24 h) | `401` on any call | Path A (Claude Code): just re-run it (auto-refreshes). Path B (Claude Chat): re-capture from DevTools. |
| Refresh token revoked | Path A (Claude Code) falls back to browser automatically | Complete the browser sign-in once. |
| Wrong plane with a PAT | `401 INVALID_AUTHORIZATION` on `/api/ui/*` | Not applicable here — this skill never uses a PAT. If you somehow have one in play, switch to the Auth0 token. |
| MFA / step-up required | Handled inside the browser sign-in | Nothing — complete it in the browser. The skill never sees MFA codes. |

---

## Non-production environments (rarely needed)

The driver recognizes other Auth0 tenants by `ServerVersion`. Only relevant if your Connect AI host isn't `cloud.cdata.com`:

| Env | Authorize / token host | API base |
|---|---|---|
| PROD | `cloud-login.cdata.com` | `https://cloud.cdata.com/api` |
| STAGE | `cdata-connect-staging.us.auth0.com` | `https://staging.clouddataos.com/api` |
| DEV | `cdata-connect-dev.us.auth0.com` | `https://dev.clouddataos.com/api` |

For these, capture the token via Path B (Claude Chat) against that host, and replace `https://cloud.cdata.com` with the matching API base everywhere. The default skill targets PROD.

---

## What is never persisted

PATs, OAuth access tokens, refresh tokens, OAuth client secrets, Basic-Auth passwords — **none** are written by this skill. A Bearer token **pasted in the Claude Chat bucket** lives in session memory only — it is never written to a file and never echoed back into the conversation. The only thing written is `cdata_connect_host.md` (host URL + auth-method label + verification timestamp). See the host-memory contract in [SKILL.md](../SKILL.md#remembering-your-host).
