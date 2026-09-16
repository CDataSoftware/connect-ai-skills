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
| Authorizing party (`azp`) | `7sXB4AwuiEZcBZH0P61h8PFKvH6d0Aoo` (public Single Page App OAuth client; override with `CDATA_PKCE_CLIENT_ID`) |
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

## Path A — Claude Code: CLI sign-in (Authorization Code + PKCE, no secret)

In the **Claude Code** bucket the primary tool is the cross-platform CLI — `node scripts/connect-cli.mjs login` (then `status` / `whoami`). It opens the browser once, then caches and silently refreshes the token. Sign-in is **Authorization Code + PKCE (S256)** against a public client, so **no client secret** is shipped or stored.

```
node scripts/connect-cli.mjs login          # browser once; caches + auto-refreshes
node scripts/connect-cli.mjs token          # print a valid access token (for raw-REST scripting)
```

Then use it: `Authorization: Bearer <token>` against `https://cloud.cdata.com/api/catalogs` (data-plane smoke test → 200).

**Agent / non-interactive sign-in (preferred when a browser can't reach this machine):**
```
node scripts/connect-cli.mjs login-start                    # prints the authorize URL, opens the browser, saves the pending verifier
node scripts/connect-cli.mjs login-finish "<redirect URL>"  # exchanges the pasted redirect URL (validates state)
```
The `oauth.cdata.com` bounce does not reliably forward the code to `localhost` for this client, so `login` (auto-catch) can time out — fall back to `login-start` / `login-finish`.

Behavior:
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

**Accepted tradeoff (call it out explicitly):** because the `access_token` is plaintext, a copied `connect-auth.json` still yields **up to ~24 h of access** until that token expires. What it does **not** yield is the *indefinite* access the refresh token gave before — the copied refresh token no longer decrypts off the origin machine, so the exposure window collapses from "forever, until manually revoked" to "at most one token TTL." That is the intended bound; enabling Auth0 refresh-token rotation would tighten it further.

**Considered and deferred:**
- **OS keystore (DPAPI / Keychain / libsecret)** — strongest, but adds per-platform code and a native dependency the CLI deliberately avoids. Not adopted now; the machine-bound encryption is the pragmatic middle option.
- **Refresh-token rotation on the Auth0 app** — complementary and worthwhile. It is an Auth0 **app-config** change (outside this repo's code), and the refresh path here is already rotation-ready: it persists a new refresh token whenever Auth0 returns one. Enabling rotation bounds the exposure window further and pairs well with the encryption above; it depends on the still-open OAuth-app-ownership decision.

**Residual risk (stated plainly):** this is not an OS keystore. A process already running as the same user on the same machine can re-derive the key and read the refresh token — there is no stored key to steal, but no hardware/OS boundary either. And because the key is derived from machine + user identifiers (hostname, username, home directory), changing any of them — a machine rename, a VM clone, a profile migration — re-derives a different key, so the stored refresh token no longer decrypts. The CLI reports this as *written on a different machine or profile* (via a non-secret key fingerprint stored beside the ciphertext), **keeps the encrypted token in place** so returning to the original machine/profile resumes silent refresh, and falls back to a browser sign-in meanwhile — degrading gracefully rather than discarding a recoverable token. (The ciphertext is removed only in the genuinely dead case: the fingerprint matches but the bytes still won't decrypt, i.e. local corruption or tampering.) Treat `connect-auth.json` as sensitive.

Useful switches: `--from-scratch` (wipe the cache, full browser flow), `--port <n>` (change the listener port).

### How sign-in works (Authorization Code + PKCE)

1. The CLI generates a random `code_verifier` and sends its SHA-256 hash (`code_challenge`, method `S256`) on the authorize request to `https://cloud-login.cdata.com/authorize`, with the public `client_id`, `redirect_uri=https://oauth.cdata.com/oauth`, `scope`, and `audience`.
   - For `login` (auto-catch), `state = base64("http://localhost:33334")` so the `oauth.cdata.com` bounce knows where to forward the code. For `login-start` / `login-finish`, `state` is a **random nonce that is validated** on return (CSRF protection).
2. The user signs in in their own browser; Auth0 redirects a one-time code to `https://oauth.cdata.com/oauth`, which bounces it to the local listener (auto-catch) or the user pastes the redirect URL (login-finish). The code may arrive base64-encoded — the CLI decodes it.
3. Token exchange at `https://cloud-login.cdata.com/oauth/token` with `grant_type=authorization_code`, the code, `redirect_uri`, and the **`code_verifier`** — **no client secret**; PKCE proves the request came from the client that started the flow.
4. Refresh later: `grant_type=refresh_token` with the public `client_id` (no secret).

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

PATs, OAuth access tokens, refresh tokens, OAuth client secrets, Basic-Auth passwords — **none** are written into a skill file or echoed back. A **PAT pasted in the Claude Chat bucket** lives in session memory only — never written to a file, never echoed back. The Path A Auth0 tokens live only in the CLI's local cache (see above), never in the chat — and there the long-lived refresh token is **encrypted at rest, bound to this machine + user**, while the short-lived access token is plaintext.
