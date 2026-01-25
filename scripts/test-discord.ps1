param(
  [string]$ApiBase = "http://localhost:8080",
  [string]$Username = "admin"
)

$ErrorActionPreference = "Stop"

function Write-HttpError {
  param([Parameter(Mandatory=$true)]$ErrorRecord)
  if ($ErrorRecord.Exception -and $ErrorRecord.Exception.Response) {
    try {
      $resp = $ErrorRecord.Exception.Response
      $status = [int]$resp.StatusCode
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $content = $reader.ReadToEnd()
      Write-Host "Status: $status" -ForegroundColor Yellow
      Write-Host $content
      return
    } catch {
      # fall through
    }
  }
  throw $ErrorRecord
}

Write-Host "API Base: $ApiBase"

$c = Get-Credential -UserName $Username -Message "Sentinel-DNS Admin Login"
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession

try {
  $loginBody = @{ username = $c.UserName; password = $c.GetNetworkCredential().Password } | ConvertTo-Json
  Invoke-WebRequest -Method Post -Uri ("$ApiBase/api/auth/login") -ContentType "application/json" -Body $loginBody -WebSession $s -UseBasicParsing | Out-Null
  Write-Host "Logged in." -ForegroundColor Green
} catch {
  Write-HttpError $_
}

try {
  $resp = Invoke-WebRequest -Method Post -Uri ("$ApiBase/api/notifications/discord/test") -ContentType "application/json" -Body "{}" -WebSession $s -UseBasicParsing
  Write-Host "Status: $($resp.StatusCode)" -ForegroundColor Green
  Write-Host $resp.Content
} catch {
  Write-HttpError $_
}
