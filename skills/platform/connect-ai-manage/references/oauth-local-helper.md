# OAuth local helper — one-shot scripted sign-in (no chat paste, no manual decode)

> **Where `$jwt` comes from:** the skill's normal Auth0 sign-in — `$jwt = & .\scripts\cdata-connect-auth.ps1` (shares the token cache with `connect-cli.mjs login`), or the pasted browser token in **Claude Chat**. The CLI's `oauth-start` / `oauth-finish` commands wrap this handshake — see [cli.md](cli.md).

Removes the friction of the manual flow. Runs a tiny **local web page + listener** on the user's machine that:
1. Calls `getAuthorizationUrl` and **auto-opens** the provider login.
2. Gives the user one box to **paste the landing URL** (the `…/connections/oauth-callback/{id}?…` page) — on the local page, **not in chat**.
3. Auto-decodes the base64 params, runs `createOAuthAccessToken`, and creates the connection.
4. Shows ✅ Connected.

## Why a fully silent capture isn't possible
CData's embedded OAuth app uses a **fixed `redirect_uri = https://oauth.cdata.com/oauth/`** (registered with the provider). We can't redirect the `code` to a localhost listener we control, so the user's browser must land on the CData callback page and the user copies that one URL. This helper reduces the whole thing to: click login → approve → paste one URL into a local page.

## The decode rule (verified on GoogleSheets)
The callback URL params are base64. Decode **each once**:
- `state` → stays base64 (the callback URL b64) — send as-is after one decode
- `iss`, `code`, `scope` → fully decoded strings

## Full helper (one PowerShell block)

```powershell
# --- inputs ---
$jwt    = "<BEARER_JWT>"
$driver = "GoogleSheets"          # or Instagram, MSTeams, etc.
$name   = "<ConnectionName>"
$driverVersion = "<version>"      # GET /api/ui/drivers/$driver
$userId = "<creatorId>"           # GET /api/ui/users/self
$extraProps = @{}                 # e.g. @{ SpreadsheetId = "..." }

$h = @{ Authorization="Bearer $jwt"; "Content-Type"="application/json"; Accept="application/json"; "X-Requested-With"="XMLHttpRequest" }
function Dec64($s){ if(-not $s){return $s}; $t=$s.Replace('-','+').Replace('_','/'); while($t.Length%4){$t+='='}; [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($t)) }

$base = @{ driver=$driver; props=@{AuthScheme="oauth"}; connectionType=0; driverVersion=$driverVersion; name=$name;
  userId=$userId; userRole=0; oAuthParams=@{}; oAuthProps=@{}; permissions=@(); userDefinedProps=@{}; walletFileContent=""; externalId=""; onPremOptions=@{agentLocationId=$null} }

# Step 1
$r1 = Invoke-RestMethod -Method Post -Uri "https://cloud.cdata.com/api/ui/oauth/getAuthorizationUrl" -Headers $h -Body ($base|ConvertTo-Json -Depth 8)

# Local capture page
$port=9899
$html = @"
<!DOCTYPE html><html><head><meta charset='utf-8'><title>CData OAuth</title>
<style>body{background:#1a1a2e;color:#fff;font-family:'Segoe UI';display:flex;justify-content:center;align-items:center;height:100vh}
.c{background:#16213e;border:1px solid #f5c400;border-radius:12px;padding:32px;width:560px}
a.btn,button{background:#f5c400;color:#1a1a2e;font-weight:700;border:none;border-radius:6px;padding:12px 18px;cursor:pointer;text-decoration:none;display:inline-block}
input{width:100%;padding:10px;border-radius:6px;border:1px solid #2a4a7f;background:#0f3460;color:#fff;margin:12px 0}
.ok{display:none;color:#4caf50;margin-top:14px}</style></head><body><div class='c'>
<h2>CData OAuth — $name</h2>
<p>1. <a class='btn' href='$($r1.oauthUrl)' target='_blank'>Sign in &amp; approve</a></p>
<p>2. After approving, copy the page URL you land on and paste it below:</p>
<form id='f'><input name='url' placeholder='https://cloud.cdata.com/connections/oauth-callback/...' required/>
<button type='submit'>Finish</button></form><p class='ok' id='ok'>Submitted — return to the terminal.</p>
</div><script>document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();
await fetch('http://localhost:$port/submit',{method:'POST',body:new URLSearchParams(new FormData(e.target))});
document.getElementById('f').style.display='none';document.getElementById('ok').style.display='block';});</script></body></html>
"@
$tmp="$env:TEMP\cdata_oauth_helper.html"; $html|Out-File $tmp -Encoding utf8
$l=New-Object System.Net.HttpListener; $l.Prefixes.Add("http://localhost:$port/"); $l.Start(); Start-Process $tmp
$landing=$null
while($l.IsListening){ $ctx=$l.GetContext(); $resp=$ctx.Response; $resp.Headers.Add("Access-Control-Allow-Origin","*")
  if($ctx.Request.HttpMethod -eq "OPTIONS"){$resp.StatusCode=200;$resp.Close();continue}
  if($ctx.Request.Url.AbsolutePath -eq "/submit"){ $b=(New-Object IO.StreamReader($ctx.Request.InputStream)).ReadToEnd()
    $b.Split("&")|%{ $kv=$_.Split("=",2); if($kv[0] -eq "url"){ $landing=[Uri]::UnescapeDataString($kv[1].Replace("+"," ")) } }
    $resp.StatusCode=200;$resp.Close();$l.Stop();break }
  $resp.StatusCode=404;$resp.Close() }

# Parse + decode
$q=[Web.HttpUtility]::ParseQueryString(([Uri]$landing).Query)
$base.oAuthParams=@{ state=(Dec64 $q["state"]); iss=(Dec64 $q["iss"]); code=(Dec64 $q["code"]); scope=(Dec64 $q["scope"]) }
if($r1.passthroughParameters){ $r1.passthroughParameters.PSObject.Properties|%{ $base.oAuthParams[$_.Name]=$_.Value } }

# Step 3 — exchange
$tok=Invoke-RestMethod -Method Post -Uri "https://cloud.cdata.com/api/ui/oauth/createOAuthAccessToken" -Headers $h -Body ($base|ConvertTo-Json -Depth 8)

# Step 4 — create
$props=@{ AuthScheme="OAuth"; InitiateOAuth="OFF"; OAuthAccessToken=$tok.oauthaccesstoken; OAuthRefreshToken=$tok.oauthrefreshtoken } + $extraProps
$body=@{ ConnectionType=0; Driver=$driver; DriverVersion=$driverVersion; Name=$name; Props=$props; Permissions=@(@{userId=$userId;opsAllowed=15}); OnPremOptions=@{} }|ConvertTo-Json -Depth 10
Invoke-RestMethod -Method Post -Uri "https://cloud.cdata.com/api/ui/account/connections" -Headers $h -Body $body | Out-Null
$conn=(Invoke-RestMethod -Method Get -Uri "https://cloud.cdata.com/api/ui/account/connections?includeSubAccounts=false" -Headers $h).connections|?{$_.name -eq $name}
"Created: $($conn.name) | ID: $($conn.id) | Tested: $($conn.isTested)"
```

## Alternative — fully hands-off via browser automation
If a managed browser (Claude-in-Chrome / Playwright) is available, the agent can open `oauthUrl`, let the user log in inside that browser, then read the final `oauth-callback` URL automatically — removing even the single paste. Use only when the user opts in to browser control.

## Security
`code`, `oauthaccesstoken`, `oauthrefreshtoken` are secrets — session memory only, never logged or persisted.
