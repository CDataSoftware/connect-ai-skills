# Instagram Driver — Create & Update

## ⚠️ Critical rule — always one single PowerShell block
PowerShell tool calls do NOT share variables between calls. `$jwt`, `$driverVersion`, `$creatorId`, `$existing` — all lost when a block ends.
Always combine: creator/driver fetch + props + API call in ONE single PowerShell block. Never split them.

## Auth scheme

Instagram uses **OAuth only** — authentication is completed through a browser sign-in (the **Sign In / Reconnect** button in the portal). There is no username/password or security-token option, so there is **no credential HTML form** for this driver.

OAuth requires an interactive browser approval, but it does **not** require the portal. Two paths:
1. **Recommended — scripted (no portal):** use the BFF handshake in the "✅ OAuth without the portal" section below (`getAuthorizationUrl` → user approves in browser → `createOAuthAccessToken` → POST with stored tokens). Verified to give `isTested=True`.
2. **Fallback — portal:** create the connection with `AuthScheme = OAuth` and `InitiateOAuth = GETANDREFRESH`, then direct the user to the portal to complete **Sign In** and **Save & Test**.

### Optional property

| What the user says | Prop name | Notes |
|---|---|---|
| Business Account Id | `BusinessAccountId` | Optional. Only required if more than one Instagram business account is managed under the same Facebook account. |

Ask the user: **"Do you have a Business Account Id to set? (optional — only needed if you manage more than one Instagram business account under the same Facebook account. Reply with the ID or 'none')"**

---

## ✅ OAuth without the portal — scripted (verified end-to-end)

Instagram authenticates through **Facebook/Meta** OAuth, and the scripted BFF handshake works fully from the API — **no portal Sign In needed**. Verified 2026-06-11: `instagram1234` created this way with `isTested=True`.

**Instagram/Meta specifics:**
- Auth endpoint is `https://graph.facebook.com/oauth/authorize` with CData's embedded Facebook app `client_id` and the Instagram/Pages scopes (`pages_show_list`, `instagram_basic`, `pages_read_engagement`, `ads_management`, `business_management`, `instagram_manage_insights`, `instagram_manage_comments`).
- The callback returns **only `state`, `code`, `rssbus`** — no `iss`/`scope` (unlike GoogleSheets) and no `session_state` (unlike the Microsoft drivers). Facebook also appends a harmless `#_=_` fragment to the URL — ignore it.
- **Decode `code` once (base64); `state` stays one-level base64 (decode once, send as-is); pass `rssbus="true"`.**
- Token response includes `oauthaccesstoken` + `oauthrefreshtoken`. Facebook codes are longer-lived than Microsoft's, so a chat round-trip is fine (no address-bar rush).

**Step 1 — getAuthorizationUrl**
```powershell
$base = @{
  driver="Instagram"; props=@{ AuthScheme="oauth" }
  connectionType=0; driverVersion="<version>"; name="<Name>"; userId=$creatorId; userRole=0
  oAuthParams=@{}; oAuthProps=@{}; permissions=@(); userDefinedProps=@{}; walletFileContent=""; externalId=""; onPremOptions=@{agentLocationId=$null}
}
$r1 = Invoke-RestMethod -Method Post -Uri "https://cloud.cdata.com/api/ui/oauth/getAuthorizationUrl" -Headers $h -Body ($base|ConvertTo-Json -Depth 8)
# give $r1.oauthUrl to the user (Facebook login); capture $r1.callbackId
```

**Step 2 — user approves** → lands on `…/oauth-callback/{callbackId}?state=…&code=…&rssbus=true#_=_`.

**Step 3 — createOAuthAccessToken**
```powershell
function D($s){ $t=$s.Replace('-','+').Replace('_','/'); while($t.Length%4){$t+='='}; [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($t)) }
$base.oAuthParams = @{ state=(D $rawState); code=(D $rawCode); rssbus="true" }
$tok = Invoke-RestMethod -Method Post -Uri "https://cloud.cdata.com/api/ui/oauth/createOAuthAccessToken" -Headers $h -Body ($base|ConvertTo-Json -Depth 8)
```

**Step 4 — persist with tokens (POST a new connection; do NOT pre-create then PUT)**
```powershell
$props = @{ AuthScheme="OAuth"; InitiateOAuth="OFF"; OAuthAccessToken=$tok.oauthaccesstoken; OAuthRefreshToken=$tok.oauthrefreshtoken }
# BusinessAccountId = "<id>"   # include only if the user provided one
$body = @{ ConnectionType=0; Driver="Instagram"; DriverVersion="<version>"; Name="<Name>"; Props=$props; Permissions=@(@{userId=$creatorId;opsAllowed=15}); OnPremOptions=@{} }|ConvertTo-Json -Depth 10
Invoke-RestMethod -Method Post -Uri "https://cloud.cdata.com/api/ui/account/connections" -Headers $h -Body $body
```

See `../oauth-without-portal.md` and `../oauth-local-helper.md` for the generic flow. The portal "Sign In" path below remains a valid fallback.

---

## Create

Run everything in ONE PowerShell block:

```powershell
$headers = @{ Authorization = "Bearer $jwt"; Accept = "application/json" }

# Creator ID + driver version
$self          = Invoke-RestMethod -Method Get -Uri "https://cloud.cdata.com/api/ui/users/self" -Headers $headers
$creatorId     = $self.id
$driverVersion = (Invoke-RestMethod -Method Get -Uri "https://cloud.cdata.com/api/ui/drivers/Instagram" -Headers $headers).version

# Permissions — creator always gets opsAllowed=15
$permissions = @(@{ userId = $creatorId; opsAllowed = 15 })
# Add extra users (opsAllowed=1) if requested, skipping any duplicate of the creator

# Props — OAuth only
$props = @{
  AuthScheme    = "OAuth"
  InitiateOAuth = "GETANDREFRESH"
  CallbackURL   = "https://oauth.cdata.com/oauth/"
  # BusinessAccountId = "<id>"   # include only if the user provided one
}

$writeHeaders = @{
  Authorization      = "Bearer $jwt"
  "Content-Type"     = "application/json"
  Accept             = "application/json"
  "X-Requested-With" = "XMLHttpRequest"
}
$body = @{
  ConnectionType = 0
  Driver         = "Instagram"
  DriverVersion  = $driverVersion
  Name           = "<Name>"
  Props          = $props
  Permissions    = @($permissions)
  OnPremOptions  = @{}
} | ConvertTo-Json -Depth 10

$r = Invoke-RestMethod -Method Post -Uri "https://cloud.cdata.com/api/ui/account/connections" -Headers $writeHeaders -Body $body

# Verify by searching the connection list (POST response body can be empty)
$conn = (Invoke-RestMethod -Method Get -Uri "https://cloud.cdata.com/api/ui/account/connections?includeSubAccounts=false" -Headers $headers).connections |
  Where-Object { $_.name -eq "<Name>" }
"Created: $($conn.name) | ID: $($conn.id) | Tested: $($conn.isTested)"
```

> Note: the connection will be created but **not tested** (`isTested = False`) until the user completes the OAuth sign-in in the portal.

After creating, tell the user:

> "Connection **\<Name\>** has been created successfully! 🎉
>
> Since Instagram uses **OAuth**, you need to finish authenticating in the portal:
>
> 1. Go to 👉 **[cloud.cdata.com/connections](https://cloud.cdata.com/connections)**
> 2. Search for **\<Name\>** in the connections list
> 3. Click ✏️ **Edit** next to it
> 4. (Optional) Enter your **Business Account Id** if you manage more than one Instagram business account under the same Facebook account
> 5. Click **Sign In** and complete the Instagram/Facebook browser login
> 6. Click **Save & Test** to confirm it's working"

---

## Update

**Step 1 — Identify the connection.** If not named by the user, list connections and ask which one.

**Step 2 — Decide the path based on what is changing:**

- **`BusinessAccountId` or other non-credential props** — apply directly via the API `PUT`. ⚠️ Remember: `PUT` always triggers a connection test. If the connection has already been authenticated (`isTested = True`), the stored OAuth token lets the test pass and the update succeeds.

- **Re-authentication / OAuth sign-in** — cannot be done via the API. Direct the user to the portal.

**Non-credential update (e.g. set BusinessAccountId) — all in ONE block:**

```powershell
$readHeaders = @{ Authorization = "Bearer $jwt"; Accept = "application/json" }
$conn   = (Invoke-RestMethod -Method Get -Uri "https://cloud.cdata.com/api/ui/account/connections?includeSubAccounts=false" -Headers $readHeaders).connections | Where-Object { $_.name -eq "<Name>" }
$connId = $conn.id

$existing     = (Invoke-RestMethod -Method Get -Uri "https://cloud.cdata.com/api/ui/account/connections/$connId" -Headers $readHeaders).connection
$driverDetail = Invoke-RestMethod -Method Get -Uri "https://cloud.cdata.com/api/ui/account/connection/Instagram/$connId" -Headers $readHeaders

$mergedProps = @{}
$driverDetail.basicProps | ForEach-Object { if ($_.currentValue) { $mergedProps[$_.propertyName] = $_.currentValue } }
foreach ($group in $driverDetail.advancedProps) {
  $group.properties | ForEach-Object { if ($_.currentValue) { $mergedProps[$_.propertyName] = $_.currentValue } }
}

# Apply change
$mergedProps["BusinessAccountId"] = "<new id>"

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

**Re-authentication / OAuth changes — direct to portal:**
> "Since **\<Name\>** uses OAuth, please re-authenticate in the portal:
> 1. Go to 👉 **[cloud.cdata.com/connections](https://cloud.cdata.com/connections)**
> 2. Search for **\<Name\>** in the connections list
> 3. Click ✏️ **Edit**
> 4. Click **Reconnect / Sign In** and complete the Instagram/Facebook browser login
> 5. Click **Save & Test** to confirm it's working

### Providing OAuth app details (Client ID / Secret / Callback URL)

⚠️ **Do NOT collect OAuth Client ID, OAuth Client Secret, or Callback URL via a local HTML form, and do NOT attempt to set them via the API.** The `PUT` connection test always fails for OAuth because the refresh token only comes from the interactive browser sign-in (`OAUTH [30003] Token should not be null.`).

When the user says they want to provide OAuth details, **just give these portal steps directly** — do not open the form, do not call the API:

> "To set your OAuth app details for **\<Name\>**, do it in the portal:
> 1. Go to 👉 **[cloud.cdata.com/connections](https://cloud.cdata.com/connections)**
> 2. Search for **\<Name\>** in the connections list
> 3. Click ✏️ **Edit**
> 4. Expand the **Advanced / OAuth** settings and enter your **OAuth Client ID**, **OAuth Client Secret**, and **Callback URL**
> 5. Click **Sign In** and complete the Instagram/Facebook browser login
> 6. Click **Save & Test** to confirm it's working""

> ⚠️ If you try to `PUT` an update on a connection that has **never** been authenticated, the connection test will fail with an OAuth error (`OAuthRefreshToken is required`). In that case, send the user to the portal to complete sign-in instead.
