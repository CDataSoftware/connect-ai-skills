# Discovery endpoint — `GET /api/ui/account/connection/{driverName}/{connectionId}`

Returns the **full connection edit-form model**: the driver's complete property schema **merged with the saved values** of one specific connection. This is the single call that powers the portal's "Edit Connection" page. Auth: **Bearer JWT only**.

```http
GET https://cloud.cdata.com/api/ui/account/connection/{driverName}/{connectionId}
Authorization: Bearer {jwt}
Accept: application/json
```

## What it gives you (and why each matters)

| Field | What it is | How the skill uses it |
|---|---|---|
| `basicProps` | Top-level props (e.g. `AuthScheme`, `UseSandbox`), each with `currentValue`, `default`, `enum`, `type` | Read `currentValue` to build `$mergedProps` before an update |
| `basicProps[AuthScheme].enum` | All selectable auth schemes for this driver | List valid scheme choices to the user — no guessing |
| `basicProps[AuthScheme].hierarchyRules` | **Per-scheme field map** — which fields appear for each scheme | Know exactly which props to send when switching/setting a scheme |
| `advancedProps` | Grouped advanced props (Connection, BulkAPI, OAuth, SSL, Logging, Schema, Miscellaneous…) | Merge `currentValue`s; look up `enum`/`default` for validation |
| `currentValue = "****REDACTED****"` | Sensitive fields (Password, SecurityToken, secrets) are never returned in clear | Tells you these MUST be re-collected before a PUT (the test will fail otherwise) |
| `userCredentialPropertyNames` | Which props are user credentials | Decide what to re-prompt for on update |
| `isTested`, `isOauthTokenPresent`, `isOAuthWeb` | Connection state | Decide PUT-vs-portal: OAuth with no token → portal sign-in required |
| `sessionProperties` | Runtime OAuth tokens (`oauthrefreshtoken`, etc.) | Confirms OAuth status |
| `version` | Driver version | Use as `DriverVersion` in the update body |
| `existingConnectionName`, `connectionCreatedBy`, `connectionLastModified*` | Metadata | Display in "details" views |

## Use 1 — Pre-update merge (already in §3 of connection-manager.md)

```powershell
$driverDetail = Invoke-RestMethod -Method Get `
  -Uri "https://cloud.cdata.com/api/ui/account/connection/$($existing.driver)/$connId" -Headers $readHeaders
$mergedProps = @{}
$driverDetail.basicProps | ForEach-Object { if ($_.currentValue) { $mergedProps[$_.propertyName] = $_.currentValue } }
foreach ($group in $driverDetail.advancedProps) {
  $group.properties | ForEach-Object { if ($_.currentValue) { $mergedProps[$_.propertyName] = $_.currentValue } }
}
```

## Use 2 — Show connection details

Read `existingConnectionName`, `version`, `isTested`, `currentValue`s and metadata to print a details view (sensitive fields show as `****REDACTED****`).

## Use 3 — Discover auth schemes & required fields (no guessing)

```powershell
$detail   = Invoke-RestMethod -Method Get -Uri "https://cloud.cdata.com/api/ui/account/connection/$driver/$connId" -Headers $readHeaders
$authProp = $detail.basicProps | Where-Object { $_.propertyName -eq "AuthScheme" }
"Available auth schemes: $($authProp.enum -join ', ')"

# Which fields does a given scheme need?
$scheme = "OAuthClient"
$authProp.hierarchyRules.$scheme | ForEach-Object {
  $req = if ($_.display -like "Required*") { "REQUIRED" } else { "optional" }
  "$($_.propertyName) [$req] — $($_.name)"
}
```

This makes the skill **driver-agnostic**: instead of hard-coding which fields each scheme needs, read `hierarchyRules` live. Combine `display = Required*` (required), `sensitivity` (collect via form), and `enum` (dropdown choices) to drive credential collection for ANY driver/scheme.

## Use 4 — Decide PUT vs. portal

- `isOAuthWeb = true` **and** `isOauthTokenPresent = false` → never authenticated → a PUT will fail the connection test (`OAuthRefreshToken / Token should not be null`). Send the user to the portal to Sign In.
- Sensitive `currentValue`s redacted → re-collect those before any PUT, or the test fails.

## Notes
- **Bearer JWT only** — PAT returns `401 INVALID_AUTHORIZATION` on `/api/ui/*`.
- `{driverName}` is the internal driver name (e.g. `Salesforce`, `Instagram`), `{connectionId}` is the GUID.
- Always pair this read with the write in **one PowerShell block** (variables don't persist across blocks).
