# ExcelOnline Driver — Create & Update

## Auth schemes

| Scheme | When to use | Credentials needed |
|---|---|---|
| **AzureAD** | Microsoft 365 / SharePoint (most common) | Browser sign-in only |
| **AzureServicePrincipal** | Service principal with client secret | Azure Tenant, OAuth Client Id, OAuth Client Secret |
| **AzureServicePrincipalCert** | Service principal with JWT certificate | Azure Tenant, OAuth Client Id, OAuth JWT Cert, OAuth JWT Cert Password |

Always ask the user: **"Which auth scheme would you like — AzureAD, AzureServicePrincipal, or AzureServicePrincipalCert?"**

⚠️ For AzureServicePrincipal / Cert, credentials are set in the portal (or via API props for the service-principal secret). For **AzureAD**, you can now authenticate **without the portal** using the scripted OAuth flow below.

Driver name: `ExcelOnline` · Verified driver version: `25.0.9518.0`

---

## ✅ AzureAD — OAuth without the portal (scripted, verified from Excel HAR)

Same BFF handshake as Teams (Microsoft identity). **ExcelOnline specifics:**
- `AuthScheme="azuread"`, embedded Azure app `client_id=c76da90a-5782-4acc-aa5b-9d47e79d6f14`.
- Auth endpoint `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`.
- Uses an **explicit Graph `Scope`** (Sites + Files read/write) — pass it in props (see below), plus `offline_access`.
- Callback returns `code`, `state`, **`session_state`** (Azure), `rssbus` — **decode `code`, `state`, AND `session_state` once each (base64)**; `session_state` decodes to a GUID. Pass `rssbus="true"` as-is. (Verified: decoding `session_state` works; do not send it base64.)
- Token response: access + refresh + expiresIn (no `oauthserverurl`).

> 🛑 **CRITICAL — Microsoft/Azure auth codes expire in ~60 seconds and are single-use.** The `cloud.cdata.com` callback page redeems the `code` itself once its SPA finishes loading, so a slow chat round-trip fails with `AADSTS70008: The provided authorization code ... has expired`. **Tell the user to copy the redirect URL straight from the browser address bar the instant it appears — before the page finishes loading — and exchange it immediately.** Verified 2026-06-11: three chat round-trips on ExcelOnline all failed with AADSTS70008; capturing the address-bar URL fast succeeded (`excel12345678`, isTested=True). This applies to **all Microsoft-identity drivers** (ExcelOnline, MSTeams, any AzureAD scheme). Non-Microsoft providers (Google, Salesforce) have longer-lived codes and tolerate the round-trip. If the chat round-trip keeps failing, fall back to the **local helper** (`../oauth-local-helper.md`), which exchanges instantly.

> ⚠️ **400 "Request Header Or Cookie Too Large" on the callback page is harmless** — it's a browser cookie-size issue on `cloud.cdata.com` (too many tabs/cookies), NOT an Excel problem. The `code` is still in the address-bar URL; grab it and continue. (Bonus: when the page 400s, its SPA does *not* run, so it won't pre-consume the code.) Fix: clear `cloud.cdata.com` cookies or use InPrivate.

**Step 1 — getAuthorizationUrl**
```powershell
$excelScope = "https://graph.microsoft.com/Sites.Read.All https://graph.microsoft.com/Sites.ReadWrite.All https://graph.microsoft.com/Files.Read https://graph.microsoft.com/Files.Read.All https://graph.microsoft.com/Files.Read.Selected https://graph.microsoft.com/Files.ReadWrite https://graph.microsoft.com/Files.ReadWrite.All https://graph.microsoft.com/Files.ReadWrite.AppFolder https://graph.microsoft.com/Files.ReadWrite.Selected"
$base = @{
  driver="ExcelOnline"
  props=@{ AuthScheme="azuread"; AzureEnvironment="GLOBAL"; UseSandbox="false"; Scope=$excelScope }
  connectionType=0; driverVersion="25.0.9518.0"; name="<Name>"; userId=$creatorId; userRole=0
  oAuthParams=@{}; oAuthProps=@{}; permissions=@(); userDefinedProps=@{}; walletFileContent=""; externalId=""; onPremOptions=@{agentLocationId=$null}
}
$r1 = Invoke-RestMethod -Method Post -Uri "https://cloud.cdata.com/api/ui/oauth/getAuthorizationUrl" -Headers $h -Body ($base|ConvertTo-Json -Depth 8)
# give $r1.oauthUrl to the user (Microsoft login); capture $r1.callbackId
```

**Step 2 — user approves** → lands on `…/oauth-callback/{callbackId}?code=…&state=…&session_state=…&rssbus=…` (ignore any 400 page; read the URL).

**Step 3 — createOAuthAccessToken** (decode all three params once; `rssbus` stays `"true"`)
```powershell
function D($s){ $t=$s.Replace('-','+').Replace('_','/'); while($t.Length%4){$t+='='}; [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($t)) }
$base.oAuthParams = @{ code=(D $rawCode); state=(D $rawState); session_state=(D $rawSession); rssbus="true" }
$tok = Invoke-RestMethod -Method Post -Uri "https://cloud.cdata.com/api/ui/oauth/createOAuthAccessToken" -Headers $h -Body ($base|ConvertTo-Json -Depth 8)
```

**Step 4 — persist with tokens**
```powershell
$props = @{ AuthScheme="AzureAD"; InitiateOAuth="OFF"; OAuthAccessToken=$tok.oauthaccesstoken; OAuthRefreshToken=$tok.oauthrefreshtoken; AzureEnvironment="GLOBAL" }
# add SharePointURL if connecting to a SharePoint-hosted workbook
$body = @{ ConnectionType=0; Driver="ExcelOnline"; DriverVersion="25.0.9518.0"; Name="<Name>"; Props=$props; Permissions=@(@{userId=$creatorId;opsAllowed=15}); OnPremOptions=@{} }|ConvertTo-Json -Depth 10
Invoke-RestMethod -Method Post -Uri "https://cloud.cdata.com/api/ui/account/connections" -Headers $h -Body $body
```

See `../oauth-without-portal.md` and `../oauth-local-helper.md`. The portal "Sign In" steps below remain a fallback.

---

## AzureAD — Create

Ask:
- **SharePoint URL** (if connecting to a SharePoint-hosted workbook) — e.g. `https://myorg.sharepoint.com/sites/MySite`
- **Use SharePoint?** — yes/no
- **Any advanced settings?** (e.g. Excel file path, table name)

Build `$props`:
```powershell
$props = @{
  AuthScheme   = "AzureAD"
  InitiateOAuth = "GETANDREFRESH"
}
# If SharePoint:
$props["SharePointURL"] = "<SharePointURL>"
```

After creating, tell the user based on the auth scheme chosen:

**AzureAD:**
> "Connection **\<Name\>** created! To activate it:
> 1. Go to 👉 **[cloud.cdata.com/connections](https://cloud.cdata.com/connections)**
> 2. In the search box, type **\<Name\>** to find the connection
> 3. Click ✏️ **Edit** next to **\<Name\>**
> 4. Click **Sign In** and complete the Microsoft browser login
> 5. Click **Save** to save the connection"

**AzureServicePrincipal:**
> "Connection **\<Name\>** created! To activate it:
> 1. Go to 👉 **[cloud.cdata.com/connections](https://cloud.cdata.com/connections)**
> 2. In the search box, type **\<Name\>** to find the connection
> 3. Click ✏️ **Edit** next to **\<Name\>**
> 4. Fill in:
>    - **Azure Tenant** — your Azure AD tenant ID
>    - **OAuth Client Id** — your app's client ID
>    - **OAuth Client Secret** — your app's client secret
>    - **SharePoint URL** *(optional)* — leave blank for OneDrive
> 5. Click **Save** to save the connection"

**AzureServicePrincipalCert:**
> "Connection **\<Name\>** created! To activate it:
> 1. Go to 👉 **[cloud.cdata.com/connections](https://cloud.cdata.com/connections)**
> 2. In the search box, type **\<Name\>** to find the connection
> 3. Click ✏️ **Edit** next to **\<Name\>**
> 4. Fill in:
>    - **Azure Tenant** — your Azure AD tenant ID
>    - **OAuth Client Id** — your app's client ID
>    - **OAuth JWT Cert** — your private key certificate
>    - **OAuth JWT Cert Password** — certificate password
>    - **SharePoint URL** *(optional)* — leave blank for OneDrive
> 5. Click **Save** to save the connection"

---

## AzureMSI — Create

No credentials needed — the connection uses the Azure managed identity of the host.

Build `$props`:
```powershell
$props = @{
  AuthScheme = "AzureMSI"
}
```

After creating, tell the user:
> "Connection **\<Name\>** created! Please verify it works:
> 1. Go to 👉 **[cloud.cdata.com/connections](https://cloud.cdata.com/connections)**
> 2. Find **\<Name\>** → click ✏️ **Edit**
> 3. Click **Save & Test** to confirm the managed identity is working"

---

## AzureAD — Update

AzureAD connections require browser sign-in. For any update, tell the user directly:
> "Since **\<Name\>** uses AzureAD, please make your changes in the portal:
> 1. Go to 👉 **[cloud.cdata.com/connections](https://cloud.cdata.com/connections)**
> 2. Find **\<Name\>** → click ✏️ **Edit**
> 3. Make your changes
> 4. Click **Sign In** if prompted
> 5. Click **Save & Test** to confirm it's working"

## AzureServicePrincipal — Post-create / Update

After creating or updating to AzureServicePrincipal, the user must fill in the required credentials in the portal. Always give the direct link with the connection ID:

> "To complete setup for **\<Name\>**, please fill in the required fields in the portal:
> 1. Go to 👉 **[cloud.cdata.com/connections](https://cloud.cdata.com/connections)**
> 2. In the search box, type **\<Name\>** to find the connection
> 3. Click ✏️ **Edit** next to **\<Name\>**
> 4. Fill in:
>    - **Azure Tenant** — your Azure AD tenant ID
>    - **OAuth Client Id** — your app's client ID
>    - **OAuth Client Secret** — your app's client secret (or OAuth JWT Cert)
>    - **SharePoint URL** *(optional)* — only if connecting to SharePoint; leave blank for OneDrive
> 5. Click **Save** to save the connection"

## AzureMSI — Update

Non-credential prop changes (e.g. SharePointURL, file path) can be applied via API directly — no browser sign-in needed.

---

## Key ExcelOnline prop names

| What the user says | Prop name | Example value |
|---|---|---|
| SharePoint site URL | `SharePointURL` | `https://myorg.sharepoint.com/sites/MySite` |
| Excel file path | `Excel File` | `/Documents/MyWorkbook.xlsx` |
| Table name | `TableName` | `Sheet1` |
| Tenant ID | `AzureTenant` | `your-tenant-id` |
