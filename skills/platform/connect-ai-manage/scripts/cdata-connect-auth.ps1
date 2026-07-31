<#
.SYNOPSIS
  Obtain (or silently refresh) a CData Connect AI access token using the
  driver's embedded OAuth client and the oauth.cdata.com bounce server.

.DESCRIPTION
  Flow:
    1. If a valid cached token exists  → return it immediately (no browser).
    2. If a cached refresh token exists → silently refresh (no browser).
    3. Otherwise                        → open the default browser to Auth0,
                                          catch the redirect on localhost:33333,
                                          exchange the code for tokens, cache them.

  The resulting token works for BOTH:
    - Data plane  : GET/POST https://cloud.cdata.com/api/*
    - Admin plane : GET/POST https://cloud.cdata.com/api/ui/*

  Tokens are cached as plaintext JSON in
  $env:LOCALAPPDATA\CData\connect-auth.json (access + refresh token). The file
  lives in your user profile, but this script applies no explicit ACL — treat it
  as sensitive, since it holds a long-lived refresh token.

.PARAMETER Port
  Local listener port. Default: 33333.

.PARAMETER TimeoutSeconds
  How long to wait for the browser to complete sign-in. Default: 300 (5 min).

.PARAMETER Force
  Skip the cache and always run the full browser flow.

.EXAMPLE
  $tok = .\cdata-connect-auth.ps1
  $headers = @{ Authorization = "Bearer $tok"; Accept = "application/json" }
  Invoke-RestMethod https://cloud.cdata.com/api/catalogs -Headers $headers
#>
param(
  [int]    $Port           = 33333,
  [int]    $TimeoutSeconds = 300,
  [switch] $Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
$AUTH_DOMAIN        = "https://cloud-login.cdata.com"
$AUDIENCE           = "https://cloud.cdata.com/api"
$SCOPE              = "offline_access"
$REGISTERED_REDIR   = "https://oauth.cdata.com/oauth/"
$LOCAL_URL          = "http://localhost:$Port"
$CACHE_FILE         = "$env:LOCALAPPDATA\CData\connect-auth.json"
$API_BASE           = "https://cloud.cdata.com"

# ---------------------------------------------------------------------------
# Decrypt embedded driver credentials (AES-128-ECB, key "_rssbus_" + spaces)
# ---------------------------------------------------------------------------
function Get-DriverCredentials {
  $keyBytes = [System.Text.Encoding]::ASCII.GetBytes("_rssbus_        ")
  $aes = [System.Security.Cryptography.Aes]::Create()
  $aes.Mode    = [System.Security.Cryptography.CipherMode]::ECB
  $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
  $aes.Key     = $keyBytes
  function d([string]$b64) {
    $c = [Convert]::FromBase64String($b64)
    $dec = $aes.CreateDecryptor()
    [System.Text.Encoding]::UTF8.GetString($dec.TransformFinalBlock($c, 0, $c.Length)).TrimEnd()
  }
  return @{
    ClientId     = d "sXU4nPhfXkEJOYXFG2fXu6B+jx1SxAql3vxq77zvc1NaIeCMmgRgQMcd2XGT537i"
    ClientSecret = d "WLdy5OMuJCpMnlc6cdX7PNQx9hX/+gCEc4Hh9LnsW3T7VL2bwh9SyFP9y5n8vxl7S8rTB98ETv4ucYumgl6R41oh4IyaBGBAxx3ZcZPnfuI="
  }
}

# ---------------------------------------------------------------------------
# Query-string parser (no System.Web dependency)
# ---------------------------------------------------------------------------
function Parse-Qs([string]$raw) {
  $out = @{}
  if ($raw.StartsWith('?')) { $raw = $raw.Substring(1) }
  foreach ($pair in $raw.Split('&')) {
    $kv = $pair.Split('=', 2)
    if ($kv.Length -eq 2) {
      $out[[Uri]::UnescapeDataString($kv[0])] = [Uri]::UnescapeDataString($kv[1])
    }
  }
  return $out
}

# ---------------------------------------------------------------------------
# Token cache (read / write)
# ---------------------------------------------------------------------------
function Read-Cache {
  if (-not (Test-Path $CACHE_FILE)) { return $null }
  try { return Get-Content $CACHE_FILE -Raw | ConvertFrom-Json } catch { return $null }
}

function Write-Cache($accessToken, $refreshToken, [long]$expiresAt) {
  $dir = Split-Path $CACHE_FILE
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  @{
    access_token  = $accessToken
    refresh_token = $refreshToken
    expires_at    = $expiresAt
  } | ConvertTo-Json | Set-Content $CACHE_FILE -Encoding UTF8
}

# ---------------------------------------------------------------------------
# Refresh-token exchange
# ---------------------------------------------------------------------------
function Invoke-Refresh($creds, $refreshToken) {
  $cid  = [Uri]::EscapeDataString($creds.ClientId)
  $csec = [Uri]::EscapeDataString($creds.ClientSecret)
  $rt   = [Uri]::EscapeDataString($refreshToken)
  $body = "grant_type=refresh_token&client_id=$cid&client_secret=$csec&refresh_token=$rt"
  return Invoke-RestMethod -Method Post -Uri "$AUTH_DOMAIN/oauth/token" `
    -ContentType "application/x-www-form-urlencoded" -Body $body
}

# ---------------------------------------------------------------------------
# Browser OAuth flow
# ---------------------------------------------------------------------------
function Invoke-BrowserFlow($creds) {
  $state   = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($LOCAL_URL))
  $authUrl = "$AUTH_DOMAIN/authorize?audience=$AUDIENCE&scope=$SCOPE&state=$state" +
             "&client_id=$($creds.ClientId)&response_type=code&redirect_uri=$REGISTERED_REDIR"

  Write-Host "cdata-auth: Opening browser for sign-in..." -ForegroundColor Cyan
  Write-Host "cdata-auth: If a sign-in page appears, complete it to continue." -ForegroundColor Cyan

  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://localhost:$Port/")
  $listener.Start()
  Start-Process $authUrl

  $async    = $listener.BeginGetContext($null, $null)
  $signaled = $async.AsyncWaitHandle.WaitOne($TimeoutSeconds * 1000)

  if (-not $signaled) {
    $listener.Stop()
    throw "Timed out waiting for OAuth callback after $TimeoutSeconds seconds."
  }

  $ctx  = $listener.EndGetContext($async)
  $rawUrl = $ctx.Request.RawUrl
  $html = "<html><body style='font-family:sans-serif;padding:2em'><h2 style='color:#080'>Sign-in complete! You can close this tab.</h2></body></html>"
  $buf  = [System.Text.Encoding]::UTF8.GetBytes($html)
  $ctx.Response.ContentType = "text/html"
  $ctx.Response.ContentLength64 = $buf.Length
  $ctx.Response.OutputStream.Write($buf, 0, $buf.Length)
  $ctx.Response.Close()
  $listener.Stop()

  $qs      = Parse-Qs ($rawUrl.Substring($rawUrl.IndexOf('?')))
  $b64Code = $qs['code']
  $errMsg  = $qs['error']

  if ($errMsg)     { throw "Auth0 error: $errMsg - $($qs['error_description'])" }
  if (-not $b64Code) { throw "No code in callback: $rawUrl" }

  # Bounce server base64-encodes the real code
  $realCode = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64Code))

  $cid  = [Uri]::EscapeDataString($creds.ClientId)
  $csec = [Uri]::EscapeDataString($creds.ClientSecret)
  $cd   = [Uri]::EscapeDataString($realCode)
  $rdr  = [Uri]::EscapeDataString($REGISTERED_REDIR)
  $body = "grant_type=authorization_code&client_id=$cid&client_secret=$csec&code=$cd&redirect_uri=$rdr"

  return Invoke-RestMethod -Method Post -Uri "$AUTH_DOMAIN/oauth/token" `
    -ContentType "application/x-www-form-urlencoded" -Body $body
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
$creds = Get-DriverCredentials
$now   = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

# 1. Try cache
if (-not $Force) {
  $cached = Read-Cache
  if ($cached) {
    if ($cached.expires_at - $now -gt 300) {
      # Token still valid (>5 min remaining)
      Write-Verbose "cdata-auth: Using cached token (expires in $(($cached.expires_at - $now)/60 -as [int]) min)"
      Write-Output $cached.access_token
      return
    }
    # 2. Try refresh
    if ($cached.refresh_token) {
      Write-Host "cdata-auth: Access token expiring, refreshing silently..." -ForegroundColor DarkCyan
      try {
        $tok = Invoke-Refresh $creds $cached.refresh_token
        $expiresAt = $now + $tok.expires_in
        Write-Cache $tok.access_token $tok.refresh_token $expiresAt
        Write-Host "cdata-auth: Token refreshed. Valid for $($tok.expires_in/3600 -as [int])h." -ForegroundColor Green
        Write-Output $tok.access_token
        return
      } catch {
        Write-Warning "cdata-auth: Refresh failed ($($_.Exception.Message)), falling back to browser flow."
      }
    }
  }
}

# 3. Full browser flow
$tok       = Invoke-BrowserFlow $creds
$expiresAt = $now + $tok.expires_in
Write-Cache $tok.access_token $tok.refresh_token $expiresAt
Write-Host "cdata-auth: Authenticated. Token valid for $($tok.expires_in/3600 -as [int])h, cached to $CACHE_FILE" -ForegroundColor Green

Write-Output $tok.access_token
