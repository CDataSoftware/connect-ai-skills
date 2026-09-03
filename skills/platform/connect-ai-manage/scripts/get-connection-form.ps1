<#
.SYNOPSIS
  Distill any CData Connect AI driver's connection form into the few facts you
  need to create a connection: auth schemes, required properties, and the
  per-user credential properties - turning the 100-300 KB driver schema into a
  10-line answer.

.DESCRIPTION
  Calls GET /api/ui/drivers/{driver} (the authoritative, Connect-AI-specific,
  always-current connection form) and prints:
    - nice name, category, version
    - default AuthScheme + all available AuthSchemes
    - required properties (driver-declared)
    - credential properties (per-user: User/Password/Token/etc.)
    - a ready-to-edit properties template for the chosen/default scheme

  Use this for ANY of the ~200 drivers - nothing is hardcoded. For the ~28 most
  common sources, reference/connection-recipes.md has the distilled output
  pre-baked so you don't even need a round-trip.

.PARAMETER Driver
  The driver name as returned by GET /api/ui/drivers (e.g. Salesforce, SQL,
  QuickBooksOnline, GoogleBigQuery). Case-sensitive.

.PARAMETER AuthScheme
  Optional. Narrow the template to one auth scheme (e.g. OAuth, Basic).

.PARAMETER Token
  Auth0 Bearer token. If omitted, the script calls cdata-connect-auth.ps1 in the
  same folder to obtain one.

.EXAMPLE
  .\get-connection-form.ps1 -Driver Salesforce
  .\get-connection-form.ps1 -Driver SQL -AuthScheme Password
#>
param(
  [Parameter(Mandatory=$true)][string] $Driver,
  [string] $AuthScheme,
  [string] $Token
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $Token) {
  $auth = Join-Path $PSScriptRoot 'cdata-connect-auth.ps1'
  if (-not (Test-Path $auth)) { throw "No -Token given and cdata-connect-auth.ps1 not found next to this script." }
  $Token = & $auth
}
$H = @{ Authorization = "Bearer $Token"; Accept = "application/json" }

try {
  $d = Invoke-RestMethod "https://cloud.cdata.com/api/ui/drivers/$Driver" -Headers $H
} catch {
  $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
  Write-Host "Driver-form endpoint returned HTTP $code for '$Driver'." -ForegroundColor Yellow
  if ($code -eq 500) {
    Write-Host "Some drivers (e.g. Jira) 500 on this endpoint. Fall back to: assemble a small" -ForegroundColor Yellow
    Write-Host "property set, create the connection, then verify by listing its schemas." -ForegroundColor Yellow
  } elseif ($code -eq 404) {
    Write-Host "Unknown driver name. List valid names with GET /api/ui/drivers (the 'driver' field)." -ForegroundColor Yellow
  }
  return
}

$props    = $d.properties
$authProp = $props | Where-Object { $_.name -eq 'AuthScheme' } | Select-Object -First 1

Write-Host ""
Write-Host ("{0}  ({1})" -f $d.niceName, $Driver) -ForegroundColor Cyan
Write-Host ("  category : {0}    version : {1}" -f $d.category, $d.version)
if ($authProp) {
  Write-Host ("  default AuthScheme : {0}" -f $authProp.default) -ForegroundColor Green
  Write-Host ("  all AuthSchemes    : {0}" -f ($authProp.values -join ' | '))
} else {
  Write-Host "  (no AuthScheme property - this driver uses direct credentials such as Server/Database/User/Password)"
}

$required = $props | Where-Object { $_.required -eq $true -and $_.name -ne 'AuthScheme' }
$creds    = $props | Where-Object { $_.userCredential -eq $true }

Write-Host ""
Write-Host "  Required properties (driver-declared):" -ForegroundColor Green
($required | ForEach-Object { "    - {0,-26} {1}" -f $_.name, $_.description }) | Write-Host
Write-Host ""
Write-Host "  Credential properties (per-user secrets):" -ForegroundColor Green
($creds | ForEach-Object { "    - {0,-26} {1}" -f $_.name, $_.description }) | Write-Host

$scheme = if ($AuthScheme) { $AuthScheme } elseif ($authProp) { $authProp.default } else { "" }
$tmpl = [ordered]@{}
if ($scheme) { $tmpl["AuthScheme"] = $scheme }
foreach ($p in $required) { $tmpl[$p.name] = "<$($p.name)>" }
foreach ($p in $creds)    { if (-not $tmpl.Contains($p.name)) { $tmpl[$p.name] = "<$($p.name)>" } }

Write-Host ""
Write-Host "  Edit-and-create template (pass these props to: connect-cli.mjs connection-create):" -ForegroundColor Green
($tmpl | ConvertTo-Json -Depth 5) -split "`n" | ForEach-Object { "    $_" } | Write-Host
Write-Host ""
Write-Host "  Note: 'required' is the driver's static set; some props are required only under" -ForegroundColor DarkGray
Write-Host "  certain AuthSchemes (see hierarchy.hierarchyRules in the raw form). Listing schemas" -ForegroundColor DarkGray
Write-Host "  after create is the source of truth: a successful list means the connection authenticates." -ForegroundColor DarkGray
