# OAuth without the portal — scripted browser-handshake flow

> **Where `$jwt` comes from:** the skill's normal Auth0 sign-in — `$jwt = & .\scripts\cdata-connect-auth.ps1` (shares the token cache with `connect-cli.mjs login`), or the pasted browser token in **Claude Chat**. The CLI's `oauth-start` / `oauth-finish` commands wrap this handshake — see [cli.md](cli.md).

**Use this when the user wants to authenticate an OAuth connection without clicking "Sign In" in the portal Edit page.** It replicates exactly what the portal does, using the admin **BFF** endpoints (Bearer JWT only). Discovered from a portal HAR capture (GoogleSheets + Instagram), verified live.

## ⚠️ Why the data-plane stored-proc route does NOT work
`POST /api/exec` (calling `GetOAuthAuthorizationURL` / `GetOAuthAccessToken`) fails in Connect AI cloud: the data plane must **open the connection** before running any procedure, and an OAuth connection can't open without a token → `OAUTH [30003] Token should not be null`. Use the **BFF** endpoints below instead.

## The three BFF endpoints

| Step | Endpoint | Purpose |
|---|---|---|
| 1 | `POST /api/ui/oauth/getAuthorizationUrl` | Returns the provider consent URL + `callbackId` |
| 2 | *(browser)* user opens URL, signs in, approves | Provider redirects to `cloud.cdata.com/connections/oauth-callback/{callbackId}?code=…&state=…&scope=…&iss=…` |
| 3 | `POST /api/ui/oauth/createOAuthAccessToken` | Exchanges the `code` → `oauthaccesstoken` + `oauthrefreshtoken` |
| 4 | `POST /api/ui/account/connections` | Persist the connection with the tokens injected (authenticated) |

The browser consent in step 2 is **unavoidable** (the user must grant access), but **no portal Edit page is needed** — the user just opens a URL and pastes back the landing URL.

## 🛑 Provider timing — Microsoft codes expire fast (read before step 2)
**Microsoft/Azure auth codes (ExcelOnline, MSTeams, any AzureAD scheme) live only ~60 seconds and are single-use.** Worse, the `cloud.cdata.com` callback page's own SPA redeems the `code` once it finishes loading — so if the user waits for the page to render, the code is already spent and `createOAuthAccessToken` returns `AADSTS70008: authorization code ... has expired`.

- **For Microsoft drivers:** tell the user to **copy the redirect URL straight from the browser address bar the instant it appears — before the page loads — and paste it back immediately.** If chat round-trips keep failing, switch to the **local helper** (`oauth-local-helper.md`), which exchanges instantly with no chat delay.
- **For Google / Salesforce:** codes are longer-lived and tolerate the chat round-trip fine.
- Verified 2026-06-11: ExcelOnline failed 3× via slow round-trip (AADSTS70008), then succeeded with the address-bar trick (`excel12345678`); MSTeams (`msteams12345678`) and GoogleSheets (`googlsheet1234567`) also succeeded; all `isTested=True`.

## ✅ Verified pattern — do NOT pre-create then PUT
The reliable, verified flow for a **new** OAuth connection is: `getAuthorizationUrl` (no `connectionId`) → user approves → `createOAuthAccessToken` → **`POST /api/ui/account/connections`** with `InitiateOAuth=OFF` + the tokens. This gives `isTested=True` immediately (verified on GoogleSheets, ExcelOnline, MSTeams).

⚠️ Do **not** pre-create a token-less connection (e.g. with `InitiateOAuth=GETANDREFRESH`) and then try to attach tokens via `PUT /updateConnection` — that path returned **HTTP 400** in testing (Salesforce, 2026-06-11) and also burns the single-use `code` if it partially runs. If a token-less connection already exists and you must convert it, **delete and recreate** via POST with the tokens rather than PUT.

## Step 1 — getAuthorizationUrl

```powershell
$h = @{ Authorization = "Bearer $jwt"; "Content-Type" = "application/json"; Accept = "application/json"; "X-Requested-With" = "XMLHttpRequest" }
$base = @{
  driver         = "<Driver>"            # e.g. GoogleSheets, Instagram, MSTeams
  props          = @{ AuthScheme = "oauth" }   # add other base props as needed
  connectionType = 0
  driverVersion  = "<version>"           # from GET /api/ui/drivers/<Driver>
  name           = "<Name>"
  userId         = $creatorId            # GET /api/ui/users/self
  userRole       = 0
  oAuthParams    = @{}
  oAuthProps     = @{}
  permissions    = @()
  userDefinedProps = @{}
  walletFileContent = ""
  externalId     = ""
  onPremOptions  = @{ agentLocationId = $null }
}
$r1 = Invoke-RestMethod -Method Post -Uri "https://cloud.cdata.com/api/ui/oauth/getAuthorizationUrl" -Headers $h -Body ($base | ConvertTo-Json -Depth 8)
"Open this URL, sign in, approve:`n$($r1.oauthUrl)"
"callbackId: $($r1.callbackId)"
$passthrough = $r1.passthroughParameters   # carry into step 3
```

## Step 2 — user approves, then paste the landing URL

Tell the user: open the `oauthUrl`, complete login + approve. They'll land on a page whose URL looks like:
`https://cloud.cdata.com/connections/oauth-callback/{callbackId}?code=XXXX&state=YYYY&scope=ZZZZ&iss=...`
Ask them to **copy that full URL** back. Parse the query string:

```powershell
$landing = "<pasted callback URL>"
$q = [System.Web.HttpUtility]::ParseQueryString(([Uri]$landing).Query)
$code  = $q["code"]; $state = $q["state"]; $scope = $q["scope"]; $iss = $q["iss"]
```

## Step 3 — createOAuthAccessToken

Reuse the **same `$base`** body, adding `oAuthParams`:

```powershell
$base.oAuthParams = @{ state = $state; iss = $iss; code = $code; scope = $scope }
# If step 1 returned passthroughParameters, merge them in (e.g. an 'rssbus' value)
if ($passthrough) { $passthrough.PSObject.Properties | ForEach-Object { $base.oAuthParams[$_.Name] = $_.Value } }

$tok = Invoke-RestMethod -Method Post -Uri "https://cloud.cdata.com/api/ui/oauth/createOAuthAccessToken" -Headers $h -Body ($base | ConvertTo-Json -Depth 8)
# Returns: oauthaccesstoken, oauthrefreshtoken, oauthexpiresin, oauthtokentimestamp
```

## Step 4 — persist the connection with tokens

Create the connection with the tokens injected and `InitiateOAuth=OFF` so it uses the stored tokens:

```powershell
$props = @{
  AuthScheme        = "OAuth"
  InitiateOAuth     = "OFF"
  OAuthAccessToken  = $tok.oauthaccesstoken
  OAuthRefreshToken = $tok.oauthrefreshtoken
  # plus any driver base props (e.g. SpreadsheetId, BusinessAccountId)
}
$writeHeaders = @{ Authorization="Bearer $jwt"; "Content-Type"="application/json"; Accept="application/json"; "X-Requested-With"="XMLHttpRequest" }
$body = @{ ConnectionType=0; Driver="<Driver>"; DriverVersion="<version>"; Name="<Name>"; Props=$props; Permissions=@(@{userId=$creatorId;opsAllowed=15}); OnPremOptions=@{} } | ConvertTo-Json -Depth 10
Invoke-RestMethod -Method Post -Uri "https://cloud.cdata.com/api/ui/account/connections" -Headers $writeHeaders -Body $body
```

> If the connection already exists (created earlier with `InitiateOAuth=GETANDREFRESH`), use `PUT /updateConnection` with the same token props instead, so the test passes using the stored token.

## Security
- The `code` and returned `oauthaccesstoken`/`oauthrefreshtoken` are **secrets** — never log, echo, or persist them. Treat any HAR containing them as sensitive.
- Tokens are held in session memory only, exactly like JWTs/PATs.

## Notes
- All four endpoints are **`/api/ui/*` → Bearer JWT only** (PAT returns 401).
- This is the same mechanism behind the portal "Sign In" button — now scriptable.
- Driver-specific scopes/redirect are chosen server-side by CData's embedded OAuth app; for a custom app, set `OAuthClientId`/`OAuthClientSecret` in `props` before step 1.
