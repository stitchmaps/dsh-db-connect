param(
  [Parameter(Mandatory=$true)][string]$PythonExe,
  [string]$Wheelhouse = (Join-Path $PSScriptRoot '..\wheelhouse')
)
$ErrorActionPreference = 'Stop'
$PythonExe = (Resolve-Path -LiteralPath $PythonExe).Path
$Wheelhouse = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Wheelhouse)
if ((Test-Path -LiteralPath $Wheelhouse) -and (Get-ChildItem -LiteralPath $Wheelhouse -Force | Select-Object -First 1)) { throw 'Use an empty wheelhouse directory to avoid mixing dependency sets.' }
New-Item -ItemType Directory -Force -Path $Wheelhouse | Out-Null
$requirements = Join-Path $PSScriptRoot '..\python\requirements.txt'
& $PythonExe -m pip download --only-binary=:all: --dest $Wheelhouse -r $requirements
if ($LASTEXITCODE -ne 0) { throw 'Wheel download failed. Check Python version, platform and package index availability.' }
Copy-Item -LiteralPath $requirements -Destination (Join-Path $Wheelhouse 'requirements.txt')
$files = @(Get-ChildItem -LiteralPath $Wheelhouse -File | Sort-Object Name | ForEach-Object {
  @{ name = $_.Name; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
$runtime = & $PythonExe -c 'import json,platform,struct;print(json.dumps({"python":platform.python_version(),"system":platform.system(),"machine":platform.machine(),"bits":struct.calcsize("P")*8}))'
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify Python runtime.' }
@{ version = 1; runtime = ($runtime | ConvertFrom-Json); files = $files } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Wheelhouse 'manifest.json') -Encoding utf8
Write-Host "Offline wheelhouse prepared: $Wheelhouse"
Write-Host 'Copy this complete directory to a machine with matching OS, architecture and Python major/minor version.'
Write-Host 'Oracle Client 19 Basic / VC runtime and SQL Server ODBC Driver 18 are separate prerequisites.'
