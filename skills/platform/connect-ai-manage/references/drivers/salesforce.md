# Salesforce Driver — Create & Update

## ⚠️ Critical rule — always one single PowerShell block
PowerShell tool calls do NOT share variables between calls. `$creds`, `$jwt`, `$driverVersion` — all lost when a block ends.
Always combine: form open + credential capture + API call in ONE single PowerShell block. Never split them.
This was proven when creating `ankittest1` — splitting the form capture and the API call caused `$creds` to be null and the connection failed to create properly.

## Auth schemes

Present all available options and ask the user to pick one:

| Scheme | When to use |
|---|---|
| **Basic** | Username + password + security token |
| **OAuth** | Browser-based OAuth login (recommended for production) |
| **OAuthClient** | Client credentials flow (server-to-server) |
| **OAuthPassword** | OAuth with username + password (resource owner flow) |
| **OAuthJWT** | OAuth with JWT bearer token |
| **OAuthPKCE** | OAuth with PKCE (enhanced browser-based security) |
| **OneLogin** | SSO via OneLogin identity provider |
| **PingFederate** | SSO via PingFederate identity provider |
| **OKTA** | SSO via Okta identity provider |
| **ADFS** | SSO via Active Directory Federation Services |
| **AzureAD** | SSO via Azure Active Directory |

Ask the user: **"Which auth scheme would you like to use? (Basic, OAuth, OAuthClient, OAuthPassword, OAuthJWT, OAuthPKCE, OneLogin, PingFederate, OKTA, ADFS, or AzureAD)"**

Routing by scheme:
- **Basic** → open the **local HTML form** (a localhost page; see "Basic auth — Create" below) to collect Username/Password/SecurityToken, then create via API. Never ask for the password in chat.
- **OAuth** → use the scripted handshake that **returns an authorization URL to give the user** (see "✅ OAuth without the portal" below). This is the **default** and is verified end-to-end (`isTested=True`, no portal). Give the user `$r1.oauthUrl`, take back the callback URL, exchange, and POST. Only fall back to the portal Sign In path if the scripted flow fails.
- **Other OAuth-family / SSO schemes** (OAuthClient, OAuthPassword, OAuthJWT, OAuthPKCE, OneLogin, PingFederate, OKTA, ADFS, AzureAD) → create the connection via API with minimal props, then direct the user to the portal to complete authentication.

---

## Basic auth — Create

Collect via local HTML form (never ask for credentials in chat):

```powershell
$port = 9876
$html = @"
<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Salesforce – Basic Auth</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#1a1a2e;font-family:'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#16213e;border:1px solid #f5c400;border-radius:12px;padding:36px 40px;width:420px}.logo{color:#f5c400;font-size:22px;font-weight:700;margin-bottom:6px}.logo span{color:#fff}h2{color:#fff;font-size:18px;margin-bottom:20px}.f{margin-bottom:18px}label{display:block;color:#b0bec5;font-size:13px;margin-bottom:6px}input{width:100%;background:#0f3460;border:1px solid #2a4a7f;border-radius:6px;padding:10px 14px;color:#fff;font-size:14px;outline:none}input:focus{border-color:#f5c400}button{width:100%;background:#f5c400;color:#1a1a2e;font-weight:700;font-size:15px;border:none;border-radius:6px;padding:12px;cursor:pointer;margin-top:8px}.ok{display:none;text-align:center;color:#4caf50;margin-top:16px}</style>
</head><body><div class="card">
<div class="logo">CData <span>Connect AI</span></div>
<h2>Salesforce — Basic Auth</h2>
<form id="f">
<div class="f"><label>Username</label><input type="text" name="User" required/></div>
<div class="f"><label>Password</label><input type="password" name="Password" required/></div>
<div class="f"><label>Security Token</label><input type="password" name="SecurityToken" required/></div>
<button type="submit">Save</button></form>
<p class="ok" id="ok">Submitted. You can close this tab.</p>
</div><script>
document.getElementById('f').addEventListener('submit',async function(e){
  e.preventDefault();
  const d=new URLSearchParams(new FormData(this));
  await fetch('http://localhost:$port/submit',{method:'POST',body:d});
  document.getElementById('f').style.display='none';
  document.getElementById('ok').style.display='block';
});
</script></body></html>
"@
$tmp = "$env:TEMP\cdata_sf_basic.html"
$html | Out-File -FilePath $tmp -Encoding utf8
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Start-Process $tmp
$creds = @{}
while ($listener.IsListening) {
  $ctx = $listener.GetContext(); $resp = $ctx.Response
  $resp.Headers.Add("Access-Control-Allow-Origin","*")
  $resp.Headers.Add("Access-Control-Allow-Methods","POST,OPTIONS")
  if ($ctx.Request.HttpMethod -eq "OPTIONS") { $resp.StatusCode=200; $resp.Close(); continue }
  if ($ctx.Request.Url.AbsolutePath -eq "/submit" -and $ctx.Request.HttpMethod -eq "POST") {
    $body = (New-Object System.IO.StreamReader($ctx.Request.InputStream)).ReadToEnd()
    $body.Split("&") | ForEach-Object {
      $kv = $_.Split("=",2)
      if ($kv.Count -eq 2) { $creds[[System.Uri]::UnescapeDataString($kv[0])] = [System.Uri]::UnescapeDataString($kv[1].Replace("+"," ")) }
    }
    $resp.StatusCode=200; $resp.Close(); $listener.Stop(); break
  }
  $resp.StatusCode=404; $resp.Close()
}
```

Also ask:
- **Login URL** — `https://login.salesforce.com/` (production) or `https://test.salesforce.com/` (sandbox)
- **Use Bulk API?** — yes/no (default: no)

Build `$props`:
```powershell
$props = @{
  AuthScheme    = "Basic"
  User          = $creds["User"]
  Password      = $creds["Password"]
  SecurityToken = $creds["SecurityToken"]
  LoginURL      = "<LoginURL>"        # e.g. https://login.salesforce.com/
  UseBulkAPI    = "false"             # set to "true" if user asked for it
}
```

---

## All non-Basic auth schemes — Create (OAuth, OAuthClient, OAuthPassword, OAuthJWT, OAuthPKCE, OneLogin, PingFederate, OKTA, ADFS, AzureAD)

For any scheme other than Basic:
1. Ask: **Login URL** — `https://login.salesforce.com/` (production) or `https://test.salesforce.com/` (sandbox)
2. Ask: **Use Bulk API?** — yes/no (default: no)
3. Create the connection via API with `AuthScheme` set to the chosen scheme and `InitiateOAuth = "GETANDREFRESH"` (where applicable).

Build `$props`:
```powershell
$props = @{
  AuthScheme    = "<ChosenScheme>"   # e.g. "OAuth", "OKTA", "AzureAD", etc.
  InitiateOAuth = "GETANDREFRESH"    # include for all OAuth-based schemes
  CallbackURL   = "https://oauth.cdata.com/oauth/"
  LoginURL      = "<LoginURL>"
  UseBulkAPI    = "false"            # set to "true" if requested
}
```

After creating, **search for the connection by name** in the list and then tell the user:

> "Connection **\<Name\>** has been created successfully! 🎉
>
> Since you chose **\<ChosenScheme\>** auth, you need to complete authentication in the portal:
>
> 1. Go to 👉 **[cloud.cdata.com/connections](https://cloud.cdata.com/connections)**
> 2. Search for **\<Name\>** in the connections list
> 3. Click ✏️ **Edit** next to it
> 4. Fill in the required authentication details for **\<ChosenScheme\>**:
>    - **OAuth / OAuthPKCE**: Click **Sign In** and complete the Salesforce browser login
>    - **OAuthClient**: Enter your Client ID and Client Secret
>    - **OAuthPassword**: Enter your Client ID, Client Secret, Username, and Password
>    - **OAuthJWT**: Enter your Client ID and upload your JWT certificate/key
>    - **OKTA / OneLogin / PingFederate**: Enter your SSO domain, Client ID, and Client Secret
>    - **ADFS**: Enter your ADFS server URL, Client ID, and credentials
>    - **AzureAD**: Enter your Azure Tenant ID, Client ID, and Client Secret
> 5. Click **Save & Test** to confirm the connection is working"

---

## ✅ OAuth without the portal — scripted (verified from Salesforce HAR)

For **OAuth** (browser sign-in) on Salesforce, you can authenticate fully from the API instead of the portal, using the BFF handshake. Confirmed from a live Salesforce sign-in capture.

**Salesforce-specific details (differ from GoogleSheets):**
- `oauthUrl` is `https://login.salesforce.com/services/oauth2/authorize?...` (use **`https://test.salesforce.com`** for sandbox) with CData's embedded Salesforce `client_id`.
- `getAuthorizationUrl` *may* return `passthroughParameters` (e.g. `pkceVerifier`). **If present, carry it into the token-exchange call** alongside `rssbus`; if absent, omit it. (Observed 2026-06-11: `pkceVerifier` was `null` for the standard Salesforce OAuth flow, and exchange succeeded with just `code`/`state`/`rssbus="true"`.)
- Salesforce callback returns `code` + `state` (no `iss`/`scope` like Google).
- The token response includes **`oauthserverurl`** (your Salesforce instance SOAP URL) in addition to access/refresh tokens — store it.
- Access token TTL is short (`oauthexpiresin=900`); the refresh token is what persists.

**Step 1 — getAuthorizationUrl**
```powershell
$base = @{
  driver="Salesforce"; props=@{ AuthScheme="oauth"; UseSandbox="false"; LoginURL=""; APIVersion="64.0"; UseBulkAPI="false" }
  connectionType=0; driverVersion="<version>"; name="<Name>"; userId=$creatorId; userRole=0
  oAuthParams=@{}; oAuthProps=@{}; permissions=@(); userDefinedProps=@{}; walletFileContent=""; externalId=""; onPremOptions=@{agentLocationId=$null}
  # For UPDATE of an existing connection, also include: connectionId = "<connId>"
}
$r1 = Invoke-RestMethod -Method Post -Uri "https://cloud.cdata.com/api/ui/oauth/getAuthorizationUrl" -Headers $h -Body ($base|ConvertTo-Json -Depth 8)
$pkce = $r1.passthroughParameters.pkceVerifier   # carry into step 3
# give $r1.oauthUrl to the user; capture callback ($r1.callbackId)
```

**Step 2 — user approves**, lands on `…/connections/oauth-callback/{callbackId}?state=…&code=…[&rssbus=…]`. Decode each param once (base64); `state` stays one-level base64, `code` fully decodes.

**Step 3 — createOAuthAccessToken** (reuse `$base`; add `pkceVerifier` only if step 1 returned one)
```powershell
$base.oAuthParams = @{ code=$code; state=$state; rssbus="true" }
if ($pkce) { $base.oAuthParams.pkceVerifier = $pkce }
$tok = Invoke-RestMethod -Method Post -Uri "https://cloud.cdata.com/api/ui/oauth/createOAuthAccessToken" -Headers $h -Body ($base|ConvertTo-Json -Depth 8)
# Returns: oauthaccesstoken, oauthrefreshtoken, oauthserverurl, oauthexpiresin, oauthtokentimestamp
```

**Step 4 — persist with tokens**
```powershell
$props = @{
  AuthScheme        = "OAuth"
  InitiateOAuth     = "OFF"
  OAuthAccessToken  = $tok.oauthaccesstoken
  OAuthRefreshToken = $tok.oauthrefreshtoken
  OAuthServerURL    = $tok.oauthserverurl
  LoginURL          = "https://login.salesforce.com/"
}
```
- **New connection (recommended):** do NOT pre-create the connection first. Run `getAuthorizationUrl` (no `connectionId`) → `createOAuthAccessToken` → **`POST /api/ui/account/connections`** with this `$props` (`InitiateOAuth=OFF` + tokens). Verified to give `isTested=True` in one pass.
- **Existing connection (re-auth / switch Basic→OAuth):** `PUT /api/ui/account/updateConnection` with this `$props` merged into the existing props. ⚠️ Note: PUT on a connection that has **no stored credentials yet** can return **HTTP 400** (observed 2026-06-11 on `salesforceskillfinal`, which had been pre-created with `InitiateOAuth=GETANDREFRESH` but no token). If PUT 400s, **delete and recreate** via POST with the tokens instead. Only use PUT when the connection already holds working credentials.

See `../oauth-without-portal.md` and `../oauth-local-helper.md` for the full generic flow and the low-friction local helper.

---

## Basic auth — Update

If the user wants to change credentials, show the same local form as Create.

If the user wants to change **LoginURL**, **UseBulkAPI**, **APIVersion**, or any other non-credential prop — apply directly via the API without a form.

If the user wants to **switch from Basic to another scheme**:
- Update `$mergedProps["AuthScheme"]` to the new scheme, add `InitiateOAuth` and `CallbackURL` if applicable
- Remove `User`, `Password`, `SecurityToken` from `$mergedProps`
- After saving, direct the user to the portal with the non-Basic instructions above.

## Non-Basic auth — Update

These connections require browser sign-in or portal form to complete any meaningful credential changes. Tell the user directly:
> "Since **\<Name\>** uses **\<Scheme\>** auth, please make your changes in the portal:
> 1. Go to 👉 **[cloud.cdata.com/connections](https://cloud.cdata.com/connections)**
> 2. Search for **\<Name\>** in the connections list
> 3. Click ✏️ **Edit**
> 4. Make your changes and re-authenticate if prompted
> 5. Click **Save & Test** to confirm it's working"

---

## Key Salesforce prop names

| What the user says | Prop name | Example value |
|---|---|---|
| Login URL | `LoginURL` | `https://login.salesforce.com/` |
| Sandbox login URL | `LoginURL` | `https://test.salesforce.com/` |
| Use Bulk API | `UseBulkAPI` | `true` / `false` |
| API version | `APIVersion` | `64.0` |
| Bulk API concurrency | `BulkAPIConcurrencyMode` | `Serial` / `Parallel` |
| Use sandbox | `UseSandbox` | `true` / `false` |
| Use display names | `UseDisplayNames` | `true` / `false` |
