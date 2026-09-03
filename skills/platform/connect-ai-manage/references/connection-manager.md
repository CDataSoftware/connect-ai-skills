# Connection Manager — guided Create / Read / Update / Delete

End-to-end management of Connect AI connections via the admin BFF (`/api/ui/*`), so routine connection work never needs the portal. This is the **guided-flow** layer on top of the raw endpoints: it asks for the driver, the auth scheme, and any needed settings, securely collects credentials, then creates and verifies the connection.

**Auth:** the same Auth0 Bearer token as everything else in this skill, from the CLI (`$jwt = & .\scripts\cdata-connect-auth.ps1` — shares the cache with `connect-cli.mjs login`). Admin is CLI-only; there is no shell-less path (see [authentication.md](authentication.md)). All snippets below assume `$jwt` is set.

> Simple cases are one CLI command (`connections`, `connection-create`, `connection-delete` — see [cli.md](cli.md)). Use the flows in THIS file when the user wants a **guided** create (pick driver → pick auth scheme → collect credentials securely), an **update** of an existing connection, **scripted OAuth without the portal**, or per-user **permissions**.

---

## ⚠️ Critical rules — never break these

### 1. Always ONE single PowerShell block
PowerShell tool calls do NOT share variables between calls. `$creds`, `$jwt`, `$driverVersion`, `$existing` — all lost when a block ends.
**Always combine into one block:** driver version fetch + credential form + API call — all in ONE PowerShell block. Never split them.

### 2. Always include creator permission at creation time
Always fetch the creator from `/api/ui/users/self` and include in the POST body with `opsAllowed = 15`.
- Do this in the **POST body** — never as a separate update call after creation.
- `opsAllowed` bitmask (connection permissions): `1`=SELECT, `2`=INSERT, `4`=UPDATE, `8`=EXECUTE/DELETE, `15`=ALL (always use 15 for the creator)

```powershell
$self = Invoke-RestMethod -Method Get -Uri "https://cloud.cdata.com/api/ui/users/self" -Headers $headers
$creatorId = $self.id
# In POST body:
Permissions = @(@{ userId = $creatorId; opsAllowed = 15 })
```

### 3. PUT always triggers a connection test
The `PUT /api/ui/account/updateConnection` endpoint always tests the connection before saving. Sensitive fields (Password, SecurityToken, OAuthClientSecret, etc.) are never returned by the API — so updating a connection that has no credentials set will always fail with `CONNECTION_TEST_FAILED`.

**Rule:** If a connection has no credentials set yet (e.g. ExcelOnline AzureServicePrincipal before portal setup) and you need to change name/authscheme/permissions → **delete and recreate** it with the correct values in the POST body. Do NOT attempt PUT.

### 4. Never ask "any other advanced settings?"
Do not ask this question for any driver.

---

## 1. List connections

**CLI:** `node scripts/connect-cli.mjs connections`

**Raw (PowerShell):**
```powershell
$headers = @{ Authorization = "Bearer $jwt"; Accept = "application/json" }
$r = Invoke-RestMethod -Method Get `
  -Uri "https://cloud.cdata.com/api/ui/account/connections?includeSubAccounts=false" `
  -Headers $headers
$r.connections | Select-Object name, driver, id, isTested | Format-Table -AutoSize
```

Show all rows as a table: **Name**, **Driver**, **ID**, **Tested**. If none, say "No connections found."

To view ONE connection's full configuration (auth schemes, current values, redacted secrets), use the edit-form endpoint — see [connection-form-endpoint.md](connection-form-endpoint.md).

## 2. Create connection (guided)

Ask: **"Which driver?"** If known from context, skip asking.

Then load the driver-specific subskill from [`drivers/`](drivers/):

| Driver | Subskill file |
|---|---|
| Salesforce | [drivers/salesforce.md](drivers/salesforce.md) |
| ExcelOnline | [drivers/excel-online.md](drivers/excel-online.md) |
| Instagram | [drivers/instagram.md](drivers/instagram.md) |
| GoogleSheets | [drivers/googlesheets.md](drivers/googlesheets.md) |
| MSTeams (Microsoft Teams) | [drivers/microsoft-teams.md](drivers/microsoft-teams.md) |
| Any other driver (incl. Acumatica, JIRA) | [drivers/generic.md](drivers/generic.md) — discover schemes/props live; also see [connection-recipes.md](connection-recipes.md) for ready-made property sets for the top ~30 sources |

**OAuth without the portal:** For any OAuth driver, if the user wants to authenticate without the portal "Sign In" page, use the scripted BFF handshake in [oauth-without-portal.md](oauth-without-portal.md) (`getAuthorizationUrl` → user approves in browser → `createOAuthAccessToken` → create with stored tokens). The data-plane stored-proc route (`/api/exec` GetOAuthAuthorizationURL) does NOT work in cloud — that file explains why. ✅ Verified end-to-end on GoogleSheets, ExcelOnline, MSTeams, Salesforce, Instagram.

**Low-friction OAuth (recommended):** Use the **local helper page** in [oauth-local-helper.md](oauth-local-helper.md) — it auto-opens the login, takes a single URL paste on a local page (not chat), and auto-decodes/exchanges/creates. A fully silent capture is impossible because CData's embedded app has a fixed `redirect_uri=https://oauth.cdata.com/oauth/` (can't redirect to localhost); the helper minimizes it to one paste. Callback params are base64 — decode each once; `state` stays one-level base64, `iss`/`code`/`scope` fully decode. (The CLI's `oauth-start`/`oauth-finish` commands wrap the same handshake — see [cli.md](cli.md).)

**Credentials are never typed into chat.** For Basic-auth style schemes, open the local HTML form (localhost) from the driver subskill; values go straight to CData over HTTPS and are never saved to disk.

Follow the subskill instructions exactly for that driver.

**Common steps for ALL drivers — all in ONE PowerShell block:**

```powershell
$headers = @{ Authorization = "Bearer $jwt"; Accept = "application/json" }

# Get creator ID and driver version in same block
$self          = Invoke-RestMethod -Method Get -Uri "https://cloud.cdata.com/api/ui/users/self" -Headers $headers
$creatorId     = $self.id
$driverVersion = (Invoke-RestMethod -Method Get -Uri "https://cloud.cdata.com/api/ui/drivers/<Driver>" -Headers $headers).version

# Get user list for additional permissions
$users = (Invoke-RestMethod -Method Get -Uri "https://cloud.cdata.com/api/ui/users" -Headers $headers).users
$users | Select-Object name, email | Format-Table -AutoSize
```

Ask: **"Any additional users that should have access? (names/emails, 'all', or 'none')"**

```powershell
# Build permissions — creator always gets opsAllowed=15
$permissions = @(@{ userId = $creatorId; opsAllowed = 15 })
# Add any extra users with opsAllowed=1 (SELECT)
$permissions += $users | Where-Object { $selectedEmails -contains $_.email } |
  ForEach-Object { @{ userId = $_.id; opsAllowed = 1 } }
```

**Execute create (all in same block as above):**
```powershell
$writeHeaders = @{
  Authorization      = "Bearer $jwt"
  "Content-Type"     = "application/json"
  Accept             = "application/json"
  "X-Requested-With" = "XMLHttpRequest"
}
$body = @{
  ConnectionType    = 0
  Driver            = "<Driver>"
  DriverVersion     = $driverVersion
  IsCacheConnection = $false
  Name              = "<Name>"
  UserId            = $creatorId
  Props             = $props
  OAuthProps        = @{}
  OnPremOptions     = @{}
  WalletFileContent = ""
  Permissions       = @($permissions)
} | ConvertTo-Json -Depth 10

$r = Invoke-RestMethod -Method Post `
  -Uri "https://cloud.cdata.com/api/ui/account/connections" `
  -Headers $writeHeaders -Body $body

# Verify
$conn = (Invoke-RestMethod -Method Get -Uri "https://cloud.cdata.com/api/ui/account/connections/$($r.id)" -Headers $headers).connection
"Created: $($conn.name) | ID: $($conn.id) | opsAllowed: $((($conn.permissions | Where-Object {$_.userId -eq $creatorId}).opsAllowed))"
```

## 3. Update connection

**Step 1 — Identify the connection.**
If not named by the user, list connections and ask which one.

**Step 2 — Check if credentials are set.**
If the connection has no credentials yet (never authenticated in portal) → **do NOT use PUT**. Instead, delete and recreate with the new values + correct permissions in the POST body.

**Step 3 — Fetch existing details (all in ONE block with the update).**

> The `GET /api/ui/account/connection/{driverName}/{connectionId}` call below returns the **full edit-form model** (driver schema + saved values). It also drives **connection details views**, **live auth-scheme discovery** (`basicProps.AuthScheme.enum` + `hierarchyRules`), and the **PUT-vs-portal decision** (`isOauthTokenPresent`, redacted sensitive values). See [connection-form-endpoint.md](connection-form-endpoint.md) for all four uses.

```powershell
$readHeaders = @{ Authorization = "Bearer $jwt"; Accept = "application/json" }
$conn   = (Invoke-RestMethod -Method Get -Uri "https://cloud.cdata.com/api/ui/account/connections?includeSubAccounts=false" -Headers $readHeaders).connections | Where-Object { $_.name -eq "<Name>" }
$connId = $conn.id

$existing     = (Invoke-RestMethod -Method Get -Uri "https://cloud.cdata.com/api/ui/account/connections/$connId" -Headers $readHeaders).connection
$driverDetail = Invoke-RestMethod -Method Get -Uri "https://cloud.cdata.com/api/ui/account/connection/$($existing.driver)/$connId" -Headers $readHeaders

$mergedProps = @{}
$driverDetail.basicProps | ForEach-Object { if ($_.currentValue) { $mergedProps[$_.propertyName] = $_.currentValue } }
foreach ($group in $driverDetail.advancedProps) {
  $group.properties | ForEach-Object { if ($_.currentValue) { $mergedProps[$_.propertyName] = $_.currentValue } }
}
# Apply user's changes to $mergedProps here
```

**Step 4 — Apply update (same block).**
```powershell
$writeHeaders = @{
  Authorization      = "Bearer $jwt"
  "Content-Type"     = "application/json"
  Accept             = "application/json"
  "X-Requested-With" = "XMLHttpRequest"
}
$updateBody = @{
  ConnectionId      = $existing.id
  ConnectionType    = $existing.connectionType
  Driver            = $existing.driver
  DriverVersion     = $existing.driverVersion
  IsCacheConnection = $false
  Name              = $existing.name
  OAuthProps        = @{}
  WalletFileContent = ""
  OnPremOptions     = @{}
  UserId            = $existing.userId
  Permissions       = @($existing.permissions)
  Props             = $mergedProps
} | ConvertTo-Json -Depth 10 -Compress

Invoke-RestMethod -Method Put -Uri "https://cloud.cdata.com/api/ui/account/updateConnection" -Headers $writeHeaders -Body $updateBody
"Updated: $($existing.name)"
```

On success confirm: "Connection **\<Name\>** updated. Changed: \<list\>."

## 4. Delete connection

If not specified, list connections and ask which one. Always confirm first:

> "Are you sure you want to delete **\<Name\>** (\<Driver\>)? This cannot be undone. Reply **yes** to confirm."

**CLI:** `node scripts/connect-cli.mjs connection-delete --id <connectionId> --confirm`

**Raw (PowerShell):**
```powershell
$headers = @{
  Authorization      = "Bearer $jwt"
  Accept             = "application/json"
  "X-Requested-With" = "XMLHttpRequest"
}
Invoke-RestMethod -Method Delete `
  -Uri "https://cloud.cdata.com/api/ui/account/connections/<connectionId>" `
  -Headers $headers
```

Confirm: "Connection **\<Name\>** deleted successfully."

---

## Error handling

| Situation | What to do |
|---|---|
| 401 | Token expired — re-run `login` (CLI auto-refreshes) |
| 403 | Tell user they need admin rights → 👉 [cloud.cdata.com/settings/users](https://cloud.cdata.com/settings/users) |
| 404 | Ask user to verify the name. Offer to list. |
| CONNECTION_TEST_FAILED | Credentials missing — delete and recreate if no creds set; ask user to re-enter creds via form if creds were set |
| AADSTS70008 (Microsoft OAuth) | Auth code expired (~60 s) — see [edge-cases.md](edge-cases.md#ms-oauth-code) |

## Security rules
- Never log, echo, or persist the JWT, OAuth codes, or OAuth tokens.
- Never collect passwords/secrets in chat — use the local HTML form (localhost) from the driver subskill.
- Always use structured JSON bodies — never string-concatenate user input into commands.
