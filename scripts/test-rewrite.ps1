param(
  [Parameter(Mandatory = $true)]
  [pscredential]$Credential,

  [string]$ApiBase = "http://localhost:8080",

  [string]$DnsServer = "127.0.0.1",

  [string]$Domain = "rewrite-test.sentinel.lan",

  [string]$Target = "1.2.3.4"
)

$ErrorActionPreference = "Stop"

function Invoke-Json {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('GET','POST','PUT','DELETE')] [string]$Method,
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter()][object]$Body,
    [Parameter(Mandatory = $true)]$Session
  )

  if ($Method -eq 'GET' -or $Method -eq 'DELETE') {
    return Invoke-RestMethod -Method $Method -Uri $Url -WebSession $Session -Headers @{ "Accept" = "application/json" }
  }

  $json = $null
  if ($null -ne $Body) {
    $json = ($Body | ConvertTo-Json -Depth 10)
  }

  return Invoke-RestMethod -Method $Method -Uri $Url -WebSession $Session -Headers @{ "Accept" = "application/json" } -ContentType "application/json" -Body $json
}

function Invoke-JsonNoContent {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('GET','POST','PUT','DELETE')] [string]$Method,
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter()][object]$Body,
    [Parameter(Mandatory = $true)]$Session
  )

  $json = $null
  if ($null -ne $Body) { $json = ($Body | ConvertTo-Json -Depth 10) }

  try {
    $resp = Invoke-WebRequest -Method $Method -Uri $Url -WebSession $Session -Headers @{ "Accept" = "application/json" } -ContentType "application/json" -Body $json -UseBasicParsing -ErrorAction Stop
    return $true
  } catch {
    if ($_.Exception.Response) {
      $code = [int]$_.Exception.Response.StatusCode
      if ($code -eq 204) { return $true }
    }
    throw
  }
}

Write-Host "API Base : $ApiBase"
Write-Host "DNS Server: $DnsServer"
Write-Host "Domain   : $Domain"
Write-Host "Target   : $Target"

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

$loginUser = $Credential.UserName
$loginPass = $Credential.GetNetworkCredential().Password

# Login to obtain HttpOnly cookie session
try {
  Invoke-Json -Method POST -Url ("$ApiBase/api/auth/login") -Body @{ username = $loginUser; password = $loginPass } -Session $session | Out-Null
  Write-Host "Logged in."
} catch {
  Write-Host "Login failed. Verify username/password and that setup is complete." -ForegroundColor Red
  throw
}

# Create rewrite
$rewriteId = $null
try {
  $created = Invoke-Json -Method POST -Url ("$ApiBase/api/dns/rewrites") -Body @{ domain = $Domain; target = $Target } -Session $session
  $rewriteId = $created.item.id
  Write-Host "Created rewrite id=$rewriteId"
} catch {
  Write-Host "Failed to create rewrite." -ForegroundColor Red
  throw
}

try {
  Write-Host "\nQuerying A record via nslookup…" -ForegroundColor Cyan
  nslookup -type=A $Domain $DnsServer

  Write-Host "\nQuerying AAAA record via nslookup (should CNAME or empty depending on target)…" -ForegroundColor Cyan
  nslookup -type=AAAA $Domain $DnsServer

  Write-Host "\nIf A answer matches $Target, rewrites are working." -ForegroundColor Green
} finally {
  if ($rewriteId) {
    try {
      Invoke-JsonNoContent -Method DELETE -Url ("$ApiBase/api/dns/rewrites/$rewriteId") -Session $session | Out-Null
      Write-Host "Cleaned up rewrite id=$rewriteId" -ForegroundColor DarkGray
    } catch {
      Write-Host "Warning: failed to delete rewrite id=$rewriteId" -ForegroundColor Yellow
    }
  }

  try {
    Invoke-Json -Method POST -Url ("$ApiBase/api/auth/logout") -Body @{} -Session $session | Out-Null
  } catch {
    # ignore
  }
}
