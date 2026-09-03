# Generic Driver — Create & Update

Use this for any driver not covered by a specific subskill (e.g. Jira, HubSpot, BigQuery, Snowflake, etc.).

---

## Create

**Step 1 — Discover the driver's auth schemes.**
```powershell
$driverInfo = Invoke-RestMethod -Method Get `
  -Uri "https://cloud.cdata.com/api/ui/drivers/<Driver>" `
  -Headers @{ Authorization = "Bearer $jwt"; Accept = "application/json" }

# List available auth schemes
$authProp = $driverInfo.hierarchy.basic | Where-Object { $_.propertyName -eq "AuthScheme" }
$authProp.allowedValues | ForEach-Object { $_ }
```

Show the user the available auth schemes and ask which one they want.

**Step 2 — Discover required props for that scheme.**
```powershell
# List basic props for the chosen scheme
$driverInfo.basicProps | Where-Object { $_.currentValue -ne $null } |
  Select-Object propertyName, description | Format-Table -AutoSize
```

**Step 3 — Collect credentials.**
If any props are sensitive (Password, Token, Secret, Key), use the local HTML form:

```powershell
$port = 9876
# Build form fields dynamically based on required sensitive props
$fields = "<div class='f'><label>Credential</label><input type='password' name='Value' required/></div>"

$html = @"
<!DOCTYPE html><html><head><meta charset="utf-8"/><title>$driver Connection</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#1a1a2e;font-family:'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#16213e;border:1px solid #f5c400;border-radius:12px;padding:36px 40px;width:420px}.logo{color:#f5c400;font-size:22px;font-weight:700;margin-bottom:6px}.logo span{color:#fff}h2{color:#fff;font-size:18px;margin-bottom:20px}.f{margin-bottom:18px}label{display:block;color:#b0bec5;font-size:13px;margin-bottom:6px}input{width:100%;background:#0f3460;border:1px solid #2a4a7f;border-radius:6px;padding:10px 14px;color:#fff;font-size:14px;outline:none}input:focus{border-color:#f5c400}button{width:100%;background:#f5c400;color:#1a1a2e;font-weight:700;font-size:15px;border:none;border-radius:6px;padding:12px;cursor:pointer;margin-top:8px}.ok{display:none;text-align:center;color:#4caf50;margin-top:16px}</style>
</head><body><div class="card">
<div class="logo">CData <span>Connect AI</span></div>
<h2>$driver</h2>
<form id="f">$fields<button type="submit">Save</button></form>
<p class="ok" id="ok">Submitted. You can close this tab.</p>
</div><script>
document.getElementById('f').addEventListener('submit',async function(e){
  e.preventDefault();const d=new URLSearchParams(new FormData(this));
  await fetch('http://localhost:$port/submit',{method:'POST',body:d});
  document.getElementById('f').style.display='none';
  document.getElementById('ok').style.display='block';
});
</script></body></html>
"@
$tmp = "$env:TEMP\cdata_generic_creds.html"
$html | Out-File -FilePath $tmp -Encoding utf8
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start(); Start-Process $tmp
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

**Step 4 — If the auth scheme requires browser sign-in** (OAuth, OAuthPKCE, AzureAD, etc.):
After creating, tell the user:
> "Connection **\<Name\>** created! To activate it:
> 1. Go to 👉 **[cloud.cdata.com/connections](https://cloud.cdata.com/connections)**
> 2. Find **\<Name\>** → click ✏️ **Edit**
> 3. Click **Sign In** and complete the browser login
> 4. Click **Save & Test** to confirm it's working"

---

## Update

Fetch the current props using the driver-detail endpoint (see main SKILL.md Step 2).

- For **non-credential changes** (e.g. URLs, toggles, API versions): apply directly via API.
- For **credential changes**: use the local HTML form above to collect new values securely.
- For **browser-based auth schemes** (OAuth, AzureAD, etc.): always direct to portal:
> "Since **\<Name\>** uses **\<AuthScheme\>**, please make your changes in the portal:
> 1. Go to 👉 **[cloud.cdata.com/connections](https://cloud.cdata.com/connections)**
> 2. Find **\<Name\>** → click ✏️ **Edit**
> 3. Make your changes
> 4. Click **Sign In** if prompted
> 5. Click **Save & Test**"
