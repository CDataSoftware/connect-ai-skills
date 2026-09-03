# Microsoft Teams Driver — Create & Update

Driver name: `MSTeams` · Verified driver version: `25.0.9608.0` · niceName: "Microsoft Teams"

## ⚠️ Critical rule — always one single PowerShell block
Combine creator/driver fetch + API call in ONE block.

## Auth — Azure AD OAuth (Microsoft 365 / Graph)

Microsoft Teams is a Microsoft Graph–backed source. The default scheme is **`AzureAD`** (sent to the BFF as `"azuread"`), which authenticates through Microsoft's identity platform. Verified from a live Teams sign-in HAR.

Other schemes (verify via the form endpoint once a connection exists): `AzureServicePrincipal` (app-only: `AzureTenant`+`OAuthClientId`+`OAuthClientSecret`), `AzureServicePrincipalCert`, `OAuthJWT`.

## ✅ OAuth without the portal — scripted (verified from Teams HAR)

Use the BFF handshake (same as GoogleSheets/Salesforce). **Teams specifics:**
- Auth endpoint is `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`, scope `offline_access https://graph.microsoft.com/.default`, CData's embedded Azure app (`client_id=ddb32a4f-f013-4100-9105-49c13ac35faf`, "CData MS Teams Connector").
- The callback returns an extra **`session_state`** param (Azure-specific) — **decode `code`, `state`, and `session_state` once each (base64)**; `session_state` decodes to a GUID. Pass `rssbus="true"` as-is. (Verified: decoding `session_state` works.)
- Token response: `oauthaccesstoken`, `oauthrefreshtoken`, `oauthexpiresin`, `oauthtokentimestamp` (no `oauthserverurl`).
- Default props observed: `DefaultGroups=CurrentUser`, `DefaultUser=AllUsers`, `AzureEnvironment=GLOBAL`.

> 🛑 **CRITICAL — Microsoft/Azure auth codes expire in ~60 seconds and are single-use.** The `cloud.cdata.com` callback page redeems the `code` itself once its SPA finishes loading, so a slow chat round-trip fails with `AADSTS70008: ... authorization code ... has expired`. **Have the user copy the redirect URL straight from the browser address bar the instant it appears — before the page loads — and exchange it immediately.** Verified 2026-06-11: ExcelOnline failed 3× via slow round-trip but succeeded once captured fast; MSTeams created the same way (`msteams12345678`, isTested=True). Applies to all Microsoft-identity drivers. If it keeps expiring, use the **local helper** (`../oauth-local-helper.md`) for an instant exchange.

**Step 1 — getAuthorizationUrl**
```powershell
$base = @{
  driver="MSTeams"
  props=@{ AuthScheme="azuread"; DefaultGroups="CurrentUser"; DefaultUser="AllUsers"; AzureEnvironment="GLOBAL" }
  connectionType=0; driverVersion="25.0.9608.0"; name="<Name>"; userId=$creatorId; userRole=0
  oAuthParams=@{}; oAuthProps=@{}; permissions=@(); userDefinedProps=@{}; walletFileContent=""; externalId=""; onPremOptions=@{agentLocationId=$null}
}
$r1 = Invoke-RestMethod -Method Post -Uri "https://cloud.cdata.com/api/ui/oauth/getAuthorizationUrl" -Headers $h -Body ($base|ConvertTo-Json -Depth 8)
# give $r1.oauthUrl to the user (Microsoft login); capture $r1.callbackId
```

**Step 2 — user approves** → lands on `…/connections/oauth-callback/{callbackId}?code=…&state=…&session_state=…&rssbus=…`. **Decode `code`, `state`, and `session_state` once each (base64);** `rssbus` stays `"true"`.

**Step 3 — createOAuthAccessToken**
```powershell
function D($s){ $t=$s.Replace('-','+').Replace('_','/'); while($t.Length%4){$t+='='}; [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($t)) }
$base.oAuthParams = @{ code=(D $rawCode); state=(D $rawState); session_state=(D $rawSession); rssbus="true" }
$tok = Invoke-RestMethod -Method Post -Uri "https://cloud.cdata.com/api/ui/oauth/createOAuthAccessToken" -Headers $h -Body ($base|ConvertTo-Json -Depth 8)
# → oauthaccesstoken, oauthrefreshtoken, oauthexpiresin, oauthtokentimestamp
```

**Step 4 — persist with tokens**
```powershell
$props = @{ AuthScheme="AzureAD"; InitiateOAuth="OFF"; OAuthAccessToken=$tok.oauthaccesstoken; OAuthRefreshToken=$tok.oauthrefreshtoken; DefaultGroups="CurrentUser"; DefaultUser="AllUsers"; AzureEnvironment="GLOBAL" }
$body = @{ ConnectionType=0; Driver="MSTeams"; DriverVersion="25.0.9608.0"; Name="<Name>"; Props=$props; Permissions=@(@{userId=$creatorId;opsAllowed=15}); OnPremOptions=@{} }|ConvertTo-Json -Depth 10
Invoke-RestMethod -Method Post -Uri "https://cloud.cdata.com/api/ui/account/connections" -Headers $h -Body $body
```

See `../oauth-without-portal.md` and `../oauth-local-helper.md` for the generic flow + low-friction local helper.

## App-only (AzureServicePrincipal) — no browser
For unattended/app-only auth, use `AuthScheme=AzureServicePrincipal` with `AzureTenant`, `OAuthClientId`, `OAuthClientSecret` directly in `$props` (no sign-in handshake). Collect the secret via the local form. The connection can then test without a browser.

## Update

Read via `GET /api/ui/account/connection/MSTeams/{connId}`, merge non-null `currentValue`s for non-credential changes, then `PUT /updateConnection` (works once authenticated). For re-authentication, re-run the scripted OAuth flow above and `PUT` with the new tokens.

## Verify schema
Run `GET /api/ui/account/connection/MSTeams/{connId}` → `basicProps.AuthScheme.enum` + `hierarchyRules` for the exact schemes/fields on your driver build (see `../connection-form-endpoint.md`).
