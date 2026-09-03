# Worked examples — PowerShell · curl · Python

Each example assumes you already have an Auth0 Bearer token (see [authentication.md](authentication.md)). Replace catalog/schema/table names with your own — discover them first (`GET /api/catalogs` → `/api/schemas` → `/api/tables`).

Throughout:
- **PowerShell:** `$H = @{ Authorization = "Bearer $tok"; Accept = "application/json" }`
- **curl:** `-H "Authorization: Bearer $TOK"`
- **Python:** `headers = {"Authorization": f"Bearer {tok}", "Accept": "application/json"}`

---

## 1. Read — "list open Salesforce cases"

**PowerShell**
```powershell
$tok = & "<skill-dir>\scripts\cdata-connect-auth.ps1"
$H = @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" }
$body = @{
  query = "SELECT [Id],[CaseNumber],[Subject],[Status],[Priority] FROM [Salesforce1].[Salesforce].[Case] WHERE [IsClosed] = 0 ORDER BY [CreatedDate] DESC LIMIT 25"
} | ConvertTo-Json
$r = Invoke-RestMethod -Method Post "https://cloud.cdata.com/api/query" -Headers $H -Body $body
if ($r.error) { "FAILED: $($r.error.code) — $($r.error.message)" }
else { $r.results[0].rows | ForEach-Object { "$($_[1])  $($_[2])  ($($_[3]))" } }
```

**curl**
```bash
curl -s https://cloud.cdata.com/api/query \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"query":"SELECT [Id],[Subject],[Status] FROM [Salesforce1].[Salesforce].[Case] WHERE [IsClosed]=0 LIMIT 25"}'
```

**Python**
```python
import requests
r = requests.post("https://cloud.cdata.com/api/query", headers=headers, json={
    "query": "SELECT [Id],[Subject],[Status] FROM [Salesforce1].[Salesforce].[Case] WHERE [IsClosed]=0 LIMIT 25"
})
body = r.json()
if body.get("error"):
    print("FAILED:", body["error"]["code"], body["error"]["message"])
else:
    for row in body["results"][0]["rows"]:
        print(row)
```

---

## 2. Read with parameters (always bind user input)

```powershell
$body = @{
  query = "SELECT [Id],[Subject] FROM [Salesforce1].[Salesforce].[Case] WHERE [Status]=@s AND [Priority]=@p LIMIT 50"
  parameters = @{
    "@s" = @{ dataType = 5; value = "Open" }      # 5 = VARCHAR
    "@p" = @{ dataType = 5; value = "High" }
  }
} | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Post "https://cloud.cdata.com/api/query" -Headers $H -ContentType "application/json" -Body $body
```

---

## 3. Insert one row

```powershell
$body = @{
  query = "INSERT INTO [HubSpot1].[HubSpot].[Contacts] ([Email],[FirstName],[LastName]) VALUES (@e,@f,@l)"
  parameters = @{
    "@e" = @{ dataType=5; value="ada@example.com" }
    "@f" = @{ dataType=5; value="Ada" }
    "@l" = @{ dataType=5; value="Lovelace" }
  }
} | ConvertTo-Json -Depth 6
$r = Invoke-RestMethod -Method Post "https://cloud.cdata.com/api/query" -Headers $H -ContentType "application/json" -Body $body
"affectedRows = $($r.results[0].affectedRows)"   # 0 ⇒ check columns / read-only fields
```

---

## 4. Batch insert (many rows, one statement)

```powershell
$body = @{
  query = "INSERT INTO [Sheets1].[GoogleSheets].[Leads] ([Name],[Score]) VALUES (@n,@sc)"
  parameters = @(
    @{ "@n" = @{dataType=5;value="Alice"}; "@sc" = @{dataType=8;value=90} },   # 8 = INTEGER
    @{ "@n" = @{dataType=5;value="Bob"};   "@sc" = @{dataType=8;value=75} }
  )
} | ConvertTo-Json -Depth 7
Invoke-RestMethod -Method Post "https://cloud.cdata.com/api/batch" -Headers $H -ContentType "application/json" -Body $body
```

---

## 5. Update (always scoped with WHERE)

```powershell
$body = @{
  query = "UPDATE [Salesforce1].[Salesforce].[Case] SET [Status]=@s WHERE [Id]=@id"
  parameters = @{ "@s" = @{dataType=5;value="Closed"}; "@id" = @{dataType=5;value="5001234567890ABC"} }
} | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Post "https://cloud.cdata.com/api/query" -Headers $H -ContentType "application/json" -Body $body
```

> Need a "delete"? This skill blocks it. Use a soft delete: `SET [Status]='Archived'`.

---

## 6. Stored procedure (`/api/exec`)

```powershell
# discover params first
Invoke-RestMethod "https://cloud.cdata.com/api/procedureParameters?catalogName=Cat&schemaName=Sch&procedureName=MyProc" -Headers $H

$body = @{
  procedure = "Cat.Sch.MyProc"
  parameters = @{
    "@InParam"  = @{ direction=1; dataType=5; value="hello" }   # 1=IN
    "@OutParam" = @{ direction=4; dataType=5; value=$null }     # 4=OUT
  }
} | ConvertTo-Json -Depth 6
$r = Invoke-RestMethod -Method Post "https://cloud.cdata.com/api/exec" -Headers $H -ContentType "application/json" -Body $body
$r.parameters       # OUT/return values land here
```

---

## 7. Column discovery when `/api/columns` is empty

```powershell
$b = '{"query":"SELECT * FROM [Cat].[Sch].[Table] LIMIT 1","schemaOnly":true}'
$r = Invoke-RestMethod -Method Post "https://cloud.cdata.com/api/query" -Headers $H -ContentType "application/json" -Body $b
$r.results[0].schema | ForEach-Object { "{0,-30} dataType={1} nullable={2}" -f $_.columnName,$_.dataType,$_.nullable }
```

---

## 8. Find the live catalogs (skip stale vendor logins)

```powershell
$c = Invoke-RestMethod "https://cloud.cdata.com/api/ui/account/connections" -Headers $H
$c.connections |
  Where-Object { $_.lastQueried } |
  Sort-Object lastQueried -Descending |
  Select-Object name, driver, lastQueried -First 10 |
  Format-Table -AutoSize
```

---

<a id="create-connection"></a>
## 9. Create a connection — learn the form, create, verify

Flow (verified against the portal's own create flow via a HAR capture): `driver-form` → `connection-create` → it verifies by listing schemas. There is **no** reliable standalone pre-create test endpoint — the portal creates first, then lists schemas.

**Claude Code (CLI) — recommended:**
```bash
node scripts/connect-cli.mjs driver-form --driver Salesforce --auth-scheme Basic     # learn props
node scripts/connect-cli.mjs connection-create --name SF_Prod --driver Salesforce \
  --props '{"AuthScheme":"Basic","User":"me@org.com","Password":"***","SecurityToken":"***"}'
# -> {"status":"created","id":"...","verified":true}   (verified = schema discovery succeeded)
node scripts/connect-cli.mjs connection-test --name SF_Prod                           # re-verify anytime
```

**Raw HTTP (with the CLI-obtained Auth0 token) — the exact body shape the portal sends (PascalCase; driver settings under `Props`):**
```jsonc
POST /api/ui/account/connections
{
  "ConnectionType": 0,
  "Driver": "Salesforce",
  "DriverVersion": "<from GET /api/ui/drivers>",
  "IsCacheConnection": false,
  "Name": "SF_Prod",
  "OAuthProps": {}, "OnPremOptions": {}, "WalletFileContent": "",
  "UserId": "<your id from GET /api/ui/users/self>",
  "Permissions": [ { "userId": "<your id>", "opsAllowed": 15 } ],
  "Props": { "AuthScheme": "Basic", "User": "me@org.com", "Password": "***",
             "SecurityToken": "***", "credentials": "shared" }
}
```
> A lowercase `{ "name", "driver", "properties" }` body returns **HTTP 500** — the keys must be PascalCase and the driver settings must be under `Props`. Create returns the connection with `isTested:false`; confirm it works with `GET /api/ui/schemas?catalogName=SF_Prod`.

---

## 10. Publish tables to a workspace

```powershell
$ws = Invoke-RestMethod -Method Post "https://cloud.cdata.com/api/ui/workspaces" `
  -Headers $H -ContentType "application/json" -Body (@{ name="SalesforceAnalytics" } | ConvertTo-Json)

# Add assets with the batch endpoint. Body is { Records: [ ... ] }, one record per table
# (fields: AssetType, ConnectionId, DataAssetCategory, ParentId, SchemaName, TableName — what the UI sends).
$records = @("Account","Contact","Case") | ForEach-Object {
  @{ AssetType = 1; ConnectionId = "<connId>"; DataAssetCategory = 1; ParentId = $null; SchemaName = "Salesforce"; TableName = $_ }
}
Invoke-RestMethod -Method Post "https://cloud.cdata.com/api/ui/workspaces/$($ws.id)/assets/fromConnection/batch" `
  -Headers $H -ContentType "application/json" -Body (@{ Records = @($records) } | ConvertTo-Json -Depth 6)
```

---

## 11. Mint a PAT for another tool (token shown once)

```powershell
$pat = Invoke-RestMethod -Method Post "https://cloud.cdata.com/api/ui/users/self/pats" `
  -Headers $H -ContentType "application/json" -Body (@{ name="my-bi-tool"; lifespan=7776000 } | ConvertTo-Json)
"PAT (copy now — shown once): $($pat.tokenString)"   # field is tokenString, NOT token
# revoke later: DELETE /api/ui/users/self/pats/$($pat.id)
```

---

## 12. Invite a user (admin)

Use `inviteNewUserList` (the portal's invite path). `role` is a **system role integer id**, not a string; see [user-management-billing.md](user-management-billing.md) for the guided flow and full body.

```powershell
$body = @{
  email = "new@example.com"
  role  = 1                     # system role integer id (1 = Query; Admin=0, ConnectionAdmin=5, UserAdmin=6). Not a string. Avoid 3 (ServiceUser, an internal OEM role).
  isInvite = $true
  canBeImpersonated = $false
  canImpersonateAsSupport = $false
  managedByScim = $false
  spreadsheetsUser = $false
  customRoleIds = @()
  permissions = @()             # [{ connectionId, opsAllowed }] to scope connection access
  workspacePermissions = @()    # [{ workspaceId, opsAllowed }] to scope workspace access
} | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Post "https://cloud.cdata.com/api/ui/user/inviteNewUserList" `
  -Headers $H -ContentType "application/json" -Body $body
```

---

## 13. A robust call wrapper (handles the HTTP-200-error envelope)

Drop-in helper that treats the error envelope correctly and surfaces real status codes.

```powershell
function Invoke-Connect {
  param([string]$Method,[string]$Path,$Body)
  $p = @{ Method=$Method; Uri="https://cloud.cdata.com$Path"; Headers=$H; UseBasicParsing=$true; ErrorAction='Stop' }
  if ($Body) { $p.Body = ($Body | ConvertTo-Json -Depth 8); $p.ContentType = "application/json" }
  try {
    $resp = Invoke-WebRequest @p
    $obj  = $resp.Content | ConvertFrom-Json
    if ($obj.PSObject.Properties.Name -contains 'error' -and $obj.error) {
      throw "API error $($obj.error.code): $($obj.error.message)"   # HTTP 200 but failed
    }
    return $obj
  } catch [System.Net.WebException] {
    $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    throw "HTTP $code on $Method $Path"
  }
}

# usage
Invoke-Connect GET "/api/catalogs"
Invoke-Connect POST "/api/query" @{ query = "SELECT 1" }
```
