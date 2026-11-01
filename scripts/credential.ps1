$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -AssemblyName System.Security
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  $entropy = [Text.Encoding]::UTF8.GetBytes('dsh-db-connect/v1')
  if ($request.op -eq 'protect') {
    $bytes = [Text.Encoding]::UTF8.GetBytes([string]$request.value)
    $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, $scope)
    $value = [Convert]::ToBase64String($protected)
  } elseif ($request.op -eq 'unprotect') {
    $bytes = [Convert]::FromBase64String([string]$request.value)
    $plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, $scope)
    $value = [Text.Encoding]::UTF8.GetString($plain)
  } else { throw 'Invalid operation' }
  @{ok=$true;value=$value} | ConvertTo-Json -Compress
} catch {
  @{ok=$false;error=@{code='CREDENTIAL_ERROR';message='Windows credential protection failed. Use the original Windows account or enter the password again.'}} | ConvertTo-Json -Compress
}
