# Authentication — Auth0 JWT (Bearer), in depth

This skill administers the **admin plane** (`/api/ui/*`), which accepts **only** an **Auth0-issued JWT** used as `Authorization: Bearer <token>`. A Personal Access Token is rejected there with `401 INVALID_AUTHORIZATION` — verified live (see [edge-cases.md](edge-cases.md#test-log)) — so there is no PAT path and no Basic-auth path for admin. The Auth0 token is obtained through the CLI's browser sign-in (below).

> **Admin is CLI-only.** Because the admin plane needs an Auth0 token and the only supported way to obtain one here is the CLI's browser sign-in, this skill works only where a shell/Node is available (Claude Code, terminals, CI, agent runtimes). On a shell-less surface (Claude Chat) there is **no supported admin path** — do **not** scrape an Auth0 token from browser DevTools. (Data-only work with no shell is a different skill — `connect-ai-direct`, via a PAT.)

---

## The token, in one paragraph

You sign in through your organization's normal login (Microsoft / SSO → Auth0 universal login → MFA, all handled by the browser). Auth0 returns a short-lived **access token** (JWT, ~24 h) and a long-lived **refresh token**. The CLI puts the access token on every request; when it nears expiry, the refresh token gets a new one silently. You only see a browser the very first time (and again only if the refresh token is ever revoked).

| Claim | Value (PROD) |
|---|---|
| Issuer (`iss`) | `https://cloud-login.cdata.com/` |
| Audience (`aud`) | `https://cloud.cdata.com/api` |
| Authorizing party (`azp`) | `lEvk7ySDJAaWHhBWPEY9fiMNYf4RN25e` (embedded driver OAuth client) |
| Algorithm | RS256 |
| TTL | 86,400 s (24 h) |
| Scope | `openid profile email offline_access` (`offline_access` yields the refresh token) |

---

## Sign in — the CLI (browser sign-in, automated)

The primary tool is the cross-platform CLI — `node scripts/connect-cli.mjs login` (then `status` / `whoami`). It opens the browser once, then caches and silently refreshes the token. This skill never uses a pre-wired MCP connector to obtain or carry the token (see SKILL.md ground rule 2).

The PowerShell helper `scripts/cdata-connect-auth.ps1` (Windows) does the same OAuth dance but just *returns a Bearer token* for raw-REST scripting. The CLI and the script share one token cache, so a single sign-in serves both.

```powershell
$tok = & "<skill-dir>\scripts\cdata-connect-auth.ps1"
$H   = @{ Authorization = "Bearer $tok"; Accept = "application/json" }
Invoke-RestMethod "https://cloud.cdata.com/api/ui/users/self" -Headers $H   # admin-plane smoke test → 200
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

## Verifying the session

| Check | Call | Pass |
|---|---|---|
| Admin plane (this skill) | `GET /api/ui/users/self` | 200 + your profile |

A `200` on `/api/ui/users/self` confirms the Auth0 token drives the admin plane. (The same token also covers the data plane, but data operations are the `connect-ai-base` / `connect-ai-direct` skills, not this one.)

---

## When the token fails

| Situation | What you'll see | Do |
|---|---|---|
| Expired (>24 h) | `401` on any call | Re-run the CLI — it auto-refreshes (or `login --from-scratch`). |
| Refresh token revoked | CLI falls back to the browser automatically | Complete the browser sign-in once. |
| A PAT was used | `401 INVALID_AUTHORIZATION` on `/api/ui/*` | Admin needs an Auth0 token; a PAT cannot drive `/api/ui/*`. Sign in with the CLI. |
| MFA / step-up required | Handled inside the browser sign-in | Nothing — complete it in the browser. The skill never sees MFA codes. |
| No shell available | can't run the CLI | Admin is unsupported on shell-less surfaces — run this skill from Claude Code (or any surface with a shell). |

---

## Non-production environments (rarely needed)

The driver recognizes other Auth0 tenants by `ServerVersion`. Only relevant if your Connect AI host isn't `cloud.cdata.com`:

| Env | Authorize / token host | API base |
|---|---|---|
| PROD | `cloud-login.cdata.com` | `https://cloud.cdata.com/api` |
| STAGE | `cdata-connect-staging.us.auth0.com` | `https://staging.clouddataos.com/api` |
| DEV | `cdata-connect-dev.us.auth0.com` | `https://dev.clouddataos.com/api` |

Sign in with the CLI against that host and replace `https://cloud.cdata.com` with the matching API base everywhere. The default skill targets PROD.

---

## What is persisted

No credential is ever written into a skill file, and none is echoed back into the conversation. What the bundled tooling *does* keep on the user's machine:

- **The CLI / PowerShell helper** cache the Auth0 access + refresh token at `%LOCALAPPDATA%\CData\connect-auth.json` (Windows) or `~/.config/CData/connect-auth.json` — **plaintext JSON**, no DPAPI/keychain. Treat it as sensitive.
- **The bundled Python helpers** (`cdata_workspaces.py`, `cdata_jobs.py`) read a token from `~/.cdata_token` when present, and otherwise fall back to the CLI's cache above.

So the accurate statement is *"tokens live in the local token cache / token file, never in a skill file"* — not *"nothing is written to disk."* Handle those files like passwords.
