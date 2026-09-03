# Google Sheets Driver — Create & Update

Driver name: `GoogleSheets` · Verified driver version: `25.0.9502.0`

## ⚠️ Critical rule — always one single PowerShell block
Combine creator/driver fetch + (form if needed) + API call in ONE block.

## Auth schemes (live from `hierarchyRules`)

| Scheme | Required fields | Credential collection |
|---|---|---|
| **OAuth** (default) | (none in body) | Browser sign-in → portal |
| **Token** | `APIKey` | Local HTML form |
| **OAuthJWT** | `OAuthJWTCert` (+ optional `OAuthJWTCertSubject`) | Service-account key → form/portal |
| **AWSWorkloadIdentity** | `AWSWorkloadIdentityConfig`, `WorkloadPoolId`, `WorkloadProjectId`, `WorkloadProviderId` | Form |
| **AzureWorkloadIdentity** | `AzureWorkloadIdentityConfig`, `WorkloadPoolId`, `WorkloadProjectId`, `WorkloadProviderId` | Form |

Base props (optional, identify the sheet): `Spreadsheet`, `SpreadsheetId`, `FolderName`.

Ask: **"Which auth scheme?"** (most users pick **OAuth** browser sign-in) and optionally **"Which spreadsheet (name or ID)?"**

## Create — OAuth (recommended)

```powershell
$props = @{
  AuthScheme    = "OAuth"
  InitiateOAuth = "GETANDREFRESH"
  CallbackURL   = "https://oauth.cdata.com/oauth/"
  # SpreadsheetId = "<id>"   # optional
}
```
After create, direct the user to the portal to **Sign In** with Google + **Save & Test** (API test fails without token).

### ✅ Recommended — OAuth without the portal (scripted, verified)
Instead of the portal Sign In, use the scripted BFF handshake to authenticate fully from the API. **Verified end-to-end on GoogleSheets** (connections `googlesheeth123`, `googlesheet789` created with `isTested: True`, no portal):
1. `POST /api/ui/oauth/getAuthorizationUrl` (driver=`GoogleSheets`, props `AuthScheme="oauth"`) → returns Google consent `oauthUrl` + `callbackId`
2. User opens the URL, signs in, approves → lands on `…/connections/oauth-callback/{callbackId}?state&iss&code&scope[&rssbus]`
3. Decode each callback param once (base64): `state` stays one-level base64; `iss`/`code`/`scope` fully decode; carry `rssbus` through as-is
4. `POST /api/ui/oauth/createOAuthAccessToken` with `oAuthParams={state,iss,code,scope,rssbus}` → `oauthaccesstoken`+`oauthrefreshtoken`
5. `POST /api/ui/account/connections` with `Props={AuthScheme:"OAuth", InitiateOAuth:"OFF", OAuthAccessToken, OAuthRefreshToken}`

Full PowerShell + the low-friction local-page helper: see **`../oauth-without-portal.md`** and **`../oauth-local-helper.md`**.

## Create — Token (API key)

Form collects `APIKey`.
```powershell
$props = @{ AuthScheme = "Token"; APIKey = $creds["APIKey"] }
```

## Create — OAuthJWT (service account)

Form collects the PEM key (`OAuthJWTCert`); set `OAuthJWTCertType = "PEMKEY_BLOB"`.
```powershell
$props = @{
  AuthScheme       = "OAuthJWT"
  InitiateOAuth    = "GETANDREFRESH"
  OAuthJWTCert     = $creds["OAuthJWTCert"]
  OAuthJWTCertType = "PEMKEY_BLOB"
  # OAuthJWTCertSubject = "<subject>"  # optional
}
```

POST body for all: ConnectionType=0, Driver="GoogleSheets", DriverVersion=$driverVersion, Name, Props=$props, Permissions creator opsAllowed=15, OnPremOptions=@{}.

## Update

Read via `GET /api/ui/account/connection/GoogleSheets/{connId}`, merge non-null `currentValue`s, apply changes, `PUT /updateConnection`. Sensitive fields (APIKey, OAuthJWTCert) are redacted → re-collect before PUT. Route OAuth re-auth to the portal.
