param(
  [Parameter(Mandatory=$true)][string]$PythonExe,
  [Parameter(Mandatory=$true)][string]$Wheelhouse,
  [string]$Venv = (Join-Path $env:LOCALAPPDATA 'dsh-db-connect\venv')
)
$ErrorActionPreference = 'Stop'
$PythonExe = (Resolve-Path -LiteralPath $PythonExe).Path
$Wheelhouse = (Resolve-Path -LiteralPath $Wheelhouse).Path
$Venv = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Venv)
$manifest = Get-Content -LiteralPath (Join-Path $Wheelhouse 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne 1) { throw 'Unsupported wheelhouse manifest.' }
$listed = @{}
foreach ($entry in $manifest.files) {
  if ($entry.name -notmatch '^[^/\\:]+$' -or $entry.name -eq '..' -or $listed.ContainsKey($entry.name)) { throw 'Invalid manifest filename.' }
  $listed[$entry.name] = $true
  $file = Join-Path $Wheelhouse $entry.name
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Checksum mismatch: $($entry.name)" }
}
foreach ($file in Get-ChildItem -LiteralPath $Wheelhouse -File) {
  if ($file.Name -ne 'manifest.json' -and !$listed.ContainsKey($file.Name)) { throw "Unlisted wheelhouse file: $($file.Name)" }
}
if (!$listed.ContainsKey('requirements.txt')) { throw 'Manifest must include requirements.txt.' }
$runtime = & $PythonExe -c 'import json,platform,struct;print(json.dumps({"python":platform.python_version(),"system":platform.system(),"machine":platform.machine(),"bits":struct.calcsize("P")*8}))'
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify Python runtime.' }
$runtime = $runtime | ConvertFrom-Json
if ($runtime.system -ne $manifest.runtime.system -or $runtime.machine -ne $manifest.runtime.machine -or $runtime.bits -ne $manifest.runtime.bits -or ($runtime.python -replace '\.\d+$','') -ne ($manifest.runtime.python -replace '\.\d+$','')) { throw 'Python major/minor, platform or architecture differs from the wheelhouse build environment.' }
if (Test-Path -LiteralPath $Venv) { throw 'Choose a new virtual environment directory; existing environments are not overwritten.' }
& $PythonExe -m venv $Venv
if ($LASTEXITCODE -ne 0) { throw 'Cannot create virtual environment. Use a full Python installation with venv support.' }
$venvPython = Join-Path $Venv 'Scripts\python.exe'
& $venvPython -m pip --isolated install --no-index --no-cache-dir --find-links $Wheelhouse -r (Join-Path $Wheelhouse 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Offline dependency installation failed. Preserve the directory for diagnosis and use a new directory on retry.' }
& $venvPython -m pip freeze | Set-Content -LiteralPath (Join-Path $Venv 'installed-requirements.txt') -Encoding utf8
Write-Host "Set this Python path in DSH > Databases > Runtime: $venvPython"
Write-Host 'No DSH profile was changed. Oracle/ODBC native drivers must be installed separately.'
