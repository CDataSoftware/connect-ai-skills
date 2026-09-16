# Authentication — Auth0 JWT (Bearer), in depth

This skill administers the **admin plane** (`/api/ui/*`), which accepts **only** an **Auth0-issued JWT** used as `Authorization: Bearer <token>`. A Personal Access Token is rejected there with `401 INVALID_AUTHORIZATION` — verified live (see [edge-cases.md](edge-cases.md#test-log)) — so there is no PAT path and no Basic-auth path for admin. The Auth0 token is obtained through the CLI's browser sign-in (below).

> **Admin is CLI-only.** Because the admin plane needs an Auth0 token and the only supported way to obtain one here is the CLI's browser sign-in, this skill works only where a shell/Node is available (Claude Code, terminals, CI, agent runtimes). On a shell-less surface (Claude Chat) there is **no supported admin path** — do **not** scrape an Auth0 token from browser DevTools. (Data-only work with no shell is a different skill — `connect-ai-direct`, via a PAT.)

---

## The token, in one paragraph

You sign in through your organization's normal login (Microsoft / SSO → Auth0 universal login → MFA, all in the browser). Auth0 returns a short-lived **access token** (JWT, ~24 h) and a long-lived **refresh token**. The CLI puts the access token on every request; when it nears expiry, the refresh token gets a new one silently. You only see a browser the very first time (and again only if the refresh token is ever revoked). Sign-in uses **Authorization Code + PKCE** against a **public** OAuth client — there is no client secret anywhere in this skill.

| Claim | Value (PROD) |
|---|---|
| Issuer (`iss`) | `https://cloud-login.cdata.com/` |
| Audience (`aud`) | `https://cloud.cdata.com/api` |
| Authorizing party (`azp`) | `7sXB4AwuiEZcBZH0P61h8PFKvH6d0Aoo` (public Single Page App OAuth client; override with `CDATA_PKCE_CLIENT_ID`) |
| Algorithm | RS256 |
| TTL | 86,400 s (24 h) |
| Scope | `openid profile email offline_access` (`offline_access` yields the refresh token) |

---

## Sign in — the CLI (Authorization Code + PKCE, no secret)

The primary tool is the cross-platform CLI — `node scripts/connect-cli.mjs login` (then `status` / `whoami`). It opens the browser once, then caches and silently refreshes the token. Sign-in is **Authorization Code + PKCE (S256)** against a public client, so **no client secret** is shipped or stored — a stolen authorization code is useless without the per-login `code_verifier`. This skill never uses a pre-wired MCP connector to obtain or carry the token (see SKILL.md ground rule 2).

```
node scripts/connect-cli.mjs login          # browser once; caches + auto-refreshes
node scripts/connect-cli.mjs whoami          # admin-plane smoke test → your profile
node scripts/connect-cli.mjs token           # print a valid access token (for raw-REST scripting)
```

**Agent / non-interactive sign-in (preferred when a browser can't reach this machine):**
```
node scripts/connect-cli.mjs login-start                    # prints the authorize URL, opens the browser, saves the pending verifier
node scripts/connect-cli.mjs login-finish "<redirect URL>"  # exchanges the pasted redirect URL (validates state)
```
The `oauth.cdata.com` bounce does not reliably forward the code to `localhost` for this client, so `login` (auto-catch) can time out — fall back to `login-start` / `login-finish`, where the user pastes the `https://oauth.cdata.com/oauth?code=...&state=...` redirect URL back. The password only ever goes into the browser page — never into chat or the CLI.

Behavior of `login` / `token`:
- **Cache hit** (token >5 min from expiry) → returns it instantly, no network.
- **Cache stale but refresh token present** → silent refresh (public-client refresh, no secret), no browser.
- **No cache / refresh failed** → opens the browser to Auth0, listens on `http://127.0.0.1:33334` (loopback only), catches the code, exchanges it with the PKCE verifier, caches the result.

Cache location: `%LOCALAPPDATA%\CData\connect-auth.json` (Windows) / `~/.config/CData/connect-auth.json`. It holds `access_token` and `expires_at` as plaintext JSON, and the **`refresh_token` encrypted at rest** — AES-256-GCM under a key derived from stable machine + user identifiers (Node built-ins only; no native dependency, no stored key). The encryption **binds the ciphertext to this machine + user** — but the key inputs are public and the salt ships in source, so this is not cryptographic secrecy: it defeats a *casual* copy (the file won't silently refresh on another box) while a determined holder who knows those inputs can still re-derive the key. When decryption fails (a foreign machine/profile, or key drift), the CLI **disables silent refresh, reports it** (`status` shows a `refreshToken` field, plus a one-line stderr note) **and re-runs sign-in** — but any *unexpired* `access_token` already in the file keeps working until it lapses (see the Accepted tradeoff below). On POSIX the file and its directory are also `chmod`'d to `600`/`700`; on Windows NTFS that mode is ignored, so the refresh-token encryption is the real at-rest control there. This is **not** an OS keystore — a process already running as you can re-derive the key — so still treat the file as sensitive. **The skill never copies this file's contents into any skill file.**

### At-rest protection — what ships and why (CLOUD-27925)

**Decision:** encrypt the **refresh token** in the cache with AES-256-GCM under a machine + user-derived key (Node `crypto` built-ins only), keep the short-lived `access_token` / `expires_at` as plaintext, and tighten file/directory permissions where the OS honors them.

**Why this shape:**
- The refresh token is the long-lived secret that silently mints access tokens (the same token is accepted on the admin plane, `/api/ui/*`). Binding its ciphertext to the machine + user defeats the concrete threat — copy the file off the box and it no longer decrypts. That is the highest-value at-rest win available with no new dependencies.
- The `access_token` stays readable on purpose: the bundled Python helpers (`cdata_jobs.py`, `cdata_workspaces.py`) and raw-REST scripting read it directly, and it self-expires in ≤24 h, so its at-rest exposure is inherently bounded.
- Keeps the CLI zero-dependency and cross-platform, and reintroduces **no** client secret.

**Accepted tradeoff (call it out explicitly):** because the `access_token` is plaintext, a copied `connect-auth.json` still yields **up to ~24 h of admin-plane access** until that token expires. What it does **not** yield is the *indefinite* access the refresh token gave before — the copied refresh token no longer decrypts off the origin machine, so the exposure window collapses from "forever, until manually revoked" to "at most one token TTL." That is the intended bound; enabling Auth0 refresh-token rotation would tighten it further.

**Considered and deferred:**
- **OS keystore (DPAPI / Keychain / libsecret)** — strongest, but adds per-platform code and a native dependency the CLI deliberately avoids. Not adopted now; the machine-bound encryption is the pragmatic middle option.
- **Refresh-token rotation on the Auth0 app** — complementary and worthwhile. It is an Auth0 **app-config** change (outside this repo's code), and the refresh path here is already rotation-ready: it persists a new refresh token whenever Auth0 returns one. Enabling rotation bounds the exposure window further and pairs well with the encryption above; it depends on the still-open OAuth-app-ownership decision.

**Residual risk (stated plainly):** this is not an OS keystore. A process already running as the same user on the same machine can re-derive the key and read the refresh token — there is no stored key to steal, but no hardware/OS boundary either. And because the key is derived from machine + user identifiers (hostname, username, home directory), changing any of them — a machine rename, a VM clone, a profile migration — re-derives a different key and discards the stored refresh token; the CLI reports this as *written on a different machine or profile* (via a non-secret key fingerprint stored beside the ciphertext) and falls back to a browser sign-in, so it degrades gracefully rather than failing silently. Treat `connect-auth.json` as sensitive.

Useful switches: `--from-scratch` (wipe the cache, full browser flow), `--port <n>` (change the listener port).

### How sign-in works (Authorization Code + PKCE)

1. The CLI generates a random `code_verifier` and sends its SHA-256 hash (`code_challenge`, method `S256`) on the authorize request to `https://cloud-login.cdata.com/authorize`, with the public `client_id`, `redirect_uri=https://oauth.cdata.com/oauth`, `scope`, and `audience`.
   - For `login` (auto-catch), `state = base64("http://localhost:33334")` so the `oauth.cdata.com` bounce knows where to forward the code. For `login-start` / `login-finish`, `state` is a **random nonce that is validated** on return (CSRF protection).
2. The user signs in in their own browser; Auth0 redirects a one-time code to `https://oauth.cdata.com/oauth`, which bounces it to the local listener (auto-catch) or the user pastes the redirect URL (login-finish). The code may arrive base64-encoded — the CLI decodes it.
3. Token exchange at `https://cloud-login.cdata.com/oauth/token` with `grant_type=authorization_code`, the code, `redirect_uri`, and the **`code_verifier`** — **no client secret**; PKCE proves the request came from the client that started the flow.
4. Refresh later: `grant_type=refresh_token` with the public `client_id` (no secret).

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

- **The CLI** caches the Auth0 tokens at `%LOCALAPPDATA%\CData\connect-auth.json` (Windows) or `~/.config/CData/connect-auth.json`. The `access_token` and `expires_at` are plaintext JSON; the **`refresh_token` is encrypted at rest** and bound to this machine + user (see "Sign in" above for the full at-rest decision). Treat the file as sensitive.
- **The bundled Python helpers** (`cdata_workspaces.py`, `cdata_jobs.py`) read a token from `~/.cdata_token` when present, and otherwise fall back to the CLI's cache above.

So the accurate statement is *"tokens live in the local token cache / token file, never in a skill file"* — not *"nothing is written to disk."* Handle those files like passwords.
