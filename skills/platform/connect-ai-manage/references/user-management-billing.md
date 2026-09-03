# User Management, PATs & Billing

Account administration via the Admin UI BFF (`/api/ui/*`): users (list / invite / edit / delete), roles, Personal Access Tokens, subscription and usage. **Auth:** the skill's normal Auth0 Bearer token from the CLI (every operation below is a CLI command; auth handled automatically). The REST endpoints are shown for reference — call them directly with the CLI-obtained Auth0 token if you prefer raw HTTP. Admin is CLI-only; a PAT can NOT call these endpoints (401), and there is no shell-less path (see [authentication.md](authentication.md)).

| Goal | CLI command | REST |
|---|---|---|
| List users | `users` | `GET /api/ui/users` |
| List roles (system + custom) | `roles` | `GET /api/ui/roles` |
| Invite a user (guided flow below) | `user-invite --email E --role N [--custom-role-ids '<json>'] [--permissions '<json>']` | `POST /api/ui/user/inviteNewUserList` |
| Edit a user (guided flow below) | `user-update --id ID --set '<json>'` | `GET` then `PUT /api/ui/users/{userId}` |
| Delete a user | `user-delete --id ID --confirm` | `DELETE /api/ui/users/{userId}` |
| My profile | `whoami` | `GET /api/ui/users/self` |
| List PATs | `pats` | `GET /api/ui/users/self/pats` |
| Create a PAT | `pat-create --name N` | `POST /api/ui/users/self/pats` |
| Delete a PAT | `pat-delete --id ID --confirm` | `DELETE /api/ui/users/self/pats/{patId}` |
| Subscription | `subscription` | `GET /api/ui/billing/subscription` |
| Usage stats | `usage` | `GET /api/ui/billing/usage` |

---

## 1 — List users

Call `users`. Present results in a Markdown table with these columns (use whatever fields are present):

| # | Name | Email | Role | Status |
|---|------|-------|------|--------|

If a field is missing from the response, omit that column. Below the table, state the total count: *"X users found."*

---

## 2 — Roles: system vs custom

`GET /api/ui/roles` returns both kinds. Split them:
- **System roles** — ID is a plain integer (e.g. `0`, `1`, `5`, `6`) → maps to the `role` field.
- **Custom roles** — ID is a UUID string → maps to the `customRoleIds` array.

Fallback list if the roles call fails:

| # | Role | Role ID | Description |
|---|------|---------|-------------|
| 1 | Administrator | `0` | Add, edit and delete actions across the application. |
| 2 | Connection Administrator | `5` | Add, edit and delete connections and manage permissions and access roles across the application. |
| 3 | User Administrator | `6` | Add, edit and delete other user administrators and query users. |
| 4 | Query | `1` | Limited privileges across the application. |

### opsAllowed reference (user/connection permissions)

| Option | Operation | opsAllowed value |
|--------|-----------|-----------------|
| Select | Read / Query data | 1 |
| Insert | Insert data | 2 |
| Update | Update data | 4 |
| Execute | Execute stored procedures | 8 |

Sum the selected values: Select only = `1` · Select+Insert = `3` · Select+Insert+Update = `7` · Select+Insert+Update+Execute = `15` · All = `31`. Apply the **same `opsAllowed`** to all selected connections unless the user explicitly asks for different levels per connection. (Connection *creators* always get `15` — see [connection-manager.md](connection-manager.md).)

---

## 3 — Invite a new user (guided, step by step)

**Always follow this exact order — do not skip or combine steps.**

1. **Ask for the email.** *"What is the email address of the user you want to invite?"* Wait.
2. **Fetch roles silently** (`roles`), split system/custom.
   - **2a.** Present ONLY the system-roles table; ask which one. **STOP and wait.** Store the integer role ID.
   - **2b.** If any custom roles exist, present them in a separate table; ask which (multi-select or 'none'). **STOP and wait.** Store UUID(s) or `[]`.
3. **Fetch connections** (`connections`, or `GET /api/ui/account/connections?includeSubAccount=False`).
   - **≤ 50 connections** — display all in a numbered table (`# | Connection ID | Name | Type`) and let the user pick (multi-select or `all`).
   - **> 50** — do NOT list them all. Prompt: type `all`, specific names, or `search <keyword>` (case-insensitive contains filter, then pick). Flag any name that doesn't match.
4. **Ask permission level** per the opsAllowed table above; compute the sum.
5. **Confirm before sending.** Show the summary and only proceed on explicit "yes":

   | Field | Value |
   |-------|-------|
   | Email | `<email>` |
   | System Role | `<Role Name>` (ID: `<role id>`) |
   | Custom Roles | `<names>` or `None` |
   | Is Invite | `true` |
   | Can Be Impersonated | `false` |
   | Can Impersonate as Support | `false` |
   | Managed by SCIM | `false` |
   | Spreadsheets User | `false` |
   | Connections | `<names>` |
   | Permission | `<ops>` (opsAllowed: `<value>`) |

   On "no"/"cancel" → *"Invite cancelled. No changes were made."*
6. **Send** — `POST /api/ui/user/inviteNewUserList` with:

```json
{
  "email": "<email>",
  "role": <system role integer id>,
  "isInvite": true,
  "canBeImpersonated": false,
  "canImpersonateAsSupport": false,
  "managedByScim": false,
  "spreadsheetsUser": false,
  "customRoleIds": ["<uuid1>"],
  "permissions": [
    { "connectionId": "<id1>", "opsAllowed": <value> }
  ],
  "workspacePermissions": []
}
```

CLI: `node scripts/connect-cli.mjs user-invite --email <email> --role <id> --custom-role-ids '["<uuid>"]' --permissions '[{"connectionId":"<id>","opsAllowed":1}]'` (omitted flags default to `[]`).

7. **Result:** 200/201 → *"✅ Invite sent successfully to **[email]**."* · 400 → check email/permissions · 409 → *"This user already exists in the system."* · 401/403 → token errors.

---

## 4 — Edit a user (guided, step by step)

1. **Show the user list** (`users`) and ask which user to edit. **STOP and wait.** Resolve to `userId`.
2. **Ask what to edit** (one or more): 1. First Name · 2. Last Name · 3. System Role · 4. Custom Roles · 5. Permissions (connection access). Map keywords ("role", "name") to the closest option and confirm. **STOP and wait.**
3. **Collect new values strictly one at a time** — one prompt, wait, next:
   - First/Last name → ask, store `firstName` / `lastName`.
   - System Role → fetch roles silently, present ONLY integer-ID roles, ask. Store `role` (integer).
   - Custom Roles → present ONLY UUID-ID roles, ask (multi or 'none'). Store `customRoleIds`.
   - Permissions → fetch connections silently, same ≤50 / >50 handling as the invite flow, then ask permission level; store `permissions` array.
4. **Confirm before saving** — summary table of only the fields being changed; explicit "yes" required. On "no" → *"Edit cancelled. No changes were made."*
5. **Send the PUT** — fetch the current user first (`GET /api/ui/users/{userId}`), merge the new values into the existing object (carry forward everything unchanged), then `PUT /api/ui/users/{userId}`.

   CLI: `node scripts/connect-cli.mjs user-update --id <userId> --set '{"firstName":"New"}'` — the CLI does the GET-merge-PUT for you; `--set` holds only the changed fields.
6. **Result:** 200 → *"✅ User **[Name]** has been successfully updated."* · 400/404/401/403 → standard messages.

---

## 5 — Delete a user / invite

1. Ask which user (email or ID). If unsure, show the user list (`users`) with a `User ID` column and let them pick by number, name, or email. Resolve to `userId`.
2. **Confirm explicitly** (destructive — ground rule: every destructive admin action is confirmed each time, echoing exactly what will be removed).
3. Run `user-delete --id <userId> --confirm` (CLI) or `DELETE /api/ui/users/{userId}`.
4. Result: 200/204 → *"✅ User **[name/email]** has been successfully deleted."* · 404 → *"User not found — they may have already been removed."*

---

<a id="pats"></a>
## 6 — Personal Access Tokens

**List** — `pats`. Render a table; **mask token values** — show only the last 6 characters prefixed with `••••••` (e.g. `••••••abc123`). If none: *"No personal access tokens found for this account."*

| # | PAT ID | Name / Label | Token (masked) | Expires | Created |
|---|--------|--------------|----------------|---------|---------|

**Create** — ask for the name first, then `pat-create --name "<name>"`. The full token is in **`tokenString`** and is shown **once** — display it clearly and warn: *"⚠️ Copy this token now — it won't be shown again."* (400 → name missing or already in use.)

**Delete** — always fetch & display the PAT list first (with IDs), ask which one (by label or ID), then `pat-delete --id <patId> --confirm`. 200/204 → success · 404 → already deleted.

> Reminder: PATs minted here are for the user's *other* tools (e.g. toolkit MCP servers — see [workspaces-toolkits.md](workspaces-toolkits.md)). This skill itself never authenticates with a PAT (ground rule 2).

---

## 7 — Subscription

`subscription` → present a clean summary table of all available fields (adapt rows to the response):

| Field | Value |
|-------|-------|
| Plan | `<plan name>` |
| Status | `<active / trialing / …>` |
| Billing Cycle | `<monthly / annual>` |
| Current Period Start / End | `<dates>` |
| Seats / Connections | `<count>` |

If the subscription expires within 7 days, highlight it: *"⚠️ Your subscription expires on [date]."*

---

## 8 — Usage statistics (rich widget)

`usage` → parse the metrics, compute `pct = used / limit * 100` (1 decimal; `null` if no limit), then render an **inline HTML widget** (via `show_widget` where available, else save as an `.html` artifact). Populate `METRICS_DATA` from the actual API response.

**Colour rules:** 0–69% green `#22c55e` · 70–89% amber `#f59e0b` · 90–99% red `#ef4444` · ≥100% dark red `#991b1b` · no limit slate `#94a3b8`.

```html
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', sans-serif; background: #f1f5f9; padding: 24px; }
  h2 { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
  .subtitle { font-size: 13px; color: #64748b; margin-bottom: 20px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .card-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; margin-bottom: 6px; }
  .card-value { font-size: 22px; font-weight: 700; color: #0f172a; }
  .card-limit { font-size: 12px; color: #94a3b8; margin-top: 2px; }
  .card-pct { font-size: 12px; font-weight: 600; margin-top: 4px; }
  .chart-wrap { background: white; border-radius: 12px; padding: 20px 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .bar-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .bar-row:last-child { margin-bottom: 0; }
  .bar-label { font-size: 13px; color: #334155; width: 140px; flex-shrink: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar-track { flex: 1; background: #f1f5f9; border-radius: 99px; height: 10px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 99px; transition: width 0.8s ease; }
  .bar-pct { font-size: 12px; font-weight: 600; width: 46px; text-align: right; flex-shrink: 0; }
  .warn { margin-top: 16px; font-size: 13px; color: #ef4444; font-weight: 500; }
</style>

<h2>CData Connect AI — Usage</h2>
<p class="subtitle">Current billing period</p>
<div class="cards" id="cards"></div>
<div class="chart-wrap" id="chart"></div>
<div id="warnings"></div>

<script>
const METRICS_DATA = [
  // Populate from API response, e.g.:
  // { label: "Queries", used: 4200, limit: 10000 },
  // { label: "Connections", used: 38, limit: 50 },
];

function getColor(pct) {
  if (pct === null) return '#94a3b8';
  if (pct >= 100) return '#991b1b';
  if (pct >= 90) return '#ef4444';
  if (pct >= 70) return '#f59e0b';
  return '#22c55e';
}

const cards = document.getElementById('cards');
const chart = document.getElementById('chart');
const warnings = document.getElementById('warnings');

METRICS_DATA.forEach(m => {
  const pct = m.limit ? +(m.used / m.limit * 100).toFixed(1) : null;
  const c = getColor(pct);
  cards.innerHTML += `
    <div class="card">
      <div class="card-label">${m.label}</div>
      <div class="card-value" style="color:${c}">${m.used.toLocaleString()}</div>
      <div class="card-limit">${m.limit ? 'of ' + m.limit.toLocaleString() : 'No limit'}</div>
      ${pct !== null ? `<div class="card-pct" style="color:${c}">${pct}% used</div>` : ''}
    </div>`;
  chart.innerHTML += `
    <div class="bar-row">
      <div class="bar-label" title="${m.label}">${m.label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:0%;background:${c}" data-pct="${pct !== null ? Math.min(pct,100) : 0}"></div>
      </div>
      <div class="bar-pct" style="color:${c}">${pct !== null ? pct + '%' : '—'}</div>
    </div>`;
  if (pct !== null && pct >= 90)
    warnings.innerHTML += `<div class="warn">⚠️ ${m.label} is at ${pct}% of your limit.</div>`;
});

requestAnimationFrame(() => {
  document.querySelectorAll('.bar-fill').forEach(el => {
    el.style.width = el.dataset.pct + '%';
  });
});
</script>
```

If `METRICS_DATA` is empty or the API returns no metrics: *"No usage data available for the current billing period."*

---

## 9 — User profile (rich card)

`whoami` → render an HTML profile card artifact. Design rules:
- Avatar shows initials (first letter of first + last name; one letter if single name).
- Format dates as `"MMM D, YYYY"`.
- Omit rows for missing fields entirely — never show blank values.
- Add extra `info-row` blocks for any additional fields the API returns.
- If the role is `Admin`, tint the badge background gold: `background: rgba(251,191,36,0.3)`.

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: linear-gradient(135deg, #e0f2fe 0%, #f0fdf4 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 32px; }
    .card { background: white; border-radius: 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.10); width: 100%; max-width: 480px; overflow: hidden; }
    .card-header { background: linear-gradient(135deg, #0ea5e9, #6366f1); padding: 36px 32px 24px; text-align: center; position: relative; }
    .avatar { width: 88px; height: 88px; border-radius: 50%; background: rgba(255,255,255,0.25); border: 4px solid rgba(255,255,255,0.6); display: flex; align-items: center; justify-content: center; font-size: 36px; font-weight: 700; color: white; margin: 0 auto 16px; text-transform: uppercase; }
    .card-header h1 { color: white; font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .card-header p { color: rgba(255,255,255,0.8); font-size: 14px; }
    .badge { display: inline-block; margin-top: 12px; padding: 4px 14px; border-radius: 99px; background: rgba(255,255,255,0.2); color: white; font-size: 12px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; }
    .card-body { padding: 28px 32px; }
    .section-title { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #94a3b8; margin-bottom: 16px; margin-top: 24px; }
    .section-title:first-child { margin-top: 0; }
    .info-row { display: flex; align-items: flex-start; gap: 14px; padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
    .info-row:last-child { border-bottom: none; }
    .info-icon { width: 36px; height: 36px; border-radius: 10px; background: #f0f9ff; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
    .info-label { font-size: 11px; color: #94a3b8; font-weight: 600; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.4px; }
    .info-value { font-size: 14px; color: #1e293b; font-weight: 500; word-break: break-all; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #22c55e; margin-right: 6px; vertical-align: middle; }
    .card-footer { background: #f8fafc; padding: 16px 32px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header">
      <div class="avatar"><!-- initials --></div>
      <h1><!-- Full Name --></h1>
      <p><!-- Email --></p>
      <span class="badge"><!-- Role --></span>
    </div>
    <div class="card-body">
      <div class="section-title">Account Details</div>
      <div class="info-row"><div class="info-icon">🪪</div><div><div class="info-label">User ID</div><div class="info-value"><!-- id --></div></div></div>
      <div class="info-row"><div class="info-icon">📧</div><div><div class="info-label">Email</div><div class="info-value"><!-- email --></div></div></div>
      <div class="info-row"><div class="info-icon">🔐</div><div><div class="info-label">Status</div><div class="info-value"><span class="status-dot"></span><!-- status --></div></div></div>
      <div class="info-row"><div class="info-icon">🏢</div><div><div class="info-label">Organization</div><div class="info-value"><!-- org / tenant --></div></div></div>
      <div class="section-title">Permissions &amp; Access</div>
      <div class="info-row"><div class="info-icon">🛡️</div><div><div class="info-label">Role</div><div class="info-value"><!-- role --></div></div></div>
      <div class="info-row"><div class="info-icon">📅</div><div><div class="info-label">Member Since</div><div class="info-value"><!-- createdAt --></div></div></div>
      <div class="info-row"><div class="info-icon">🕐</div><div><div class="info-label">Last Login</div><div class="info-value"><!-- lastLoginAt --></div></div></div>
      <!-- Add more rows for any additional fields returned by the API -->
    </div>
    <div class="card-footer">CData Connect AI &nbsp;·&nbsp; <!-- current date --></div>
  </div>
</body>
</html>
```

On success render the card and say: *"Here's your profile."*

---

## Error handling

- 401 → token expired/invalid — re-run `login` (CLI silently refreshes). A PAT also 401s here — admin needs the Auth0 CLI token.
- 403 → this user lacks permission for that endpoint (RBAC) — surface it, don't bypass.
- 404 → endpoint or resource not found — double-check the URL/ID.
- Other → surface the status code and raw error body.

## Security rules
- Never log or echo full tokens (Bearer or PAT) in responses; mask PATs except at creation time (shown once by design).
- No credential is ever written into a skill file or echoed into chat. The CLI caches the Auth0 token in the local token cache (`connect-auth.json`), and the bundled Python helpers may read `~/.cdata_token` — treat those files as sensitive. See [authentication.md](authentication.md#what-is-persisted).
