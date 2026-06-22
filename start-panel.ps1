$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$homeFromProject = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $root))
$bundledNode = Join-Path $homeFromProject ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$bundledPython = Join-Path $homeFromProject ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$logPath = Join-Path $root "panel-server.log"

"[$(Get-Date -Format s)] Panel baslatiliyor" | Out-File -FilePath $logPath -Encoding utf8
"Proje: $root" | Out-File -FilePath $logPath -Encoding utf8 -Append
"Node aday yolu: $bundledNode" | Out-File -FilePath $logPath -Encoding utf8 -Append
"Python aday yolu: $bundledPython" | Out-File -FilePath $logPath -Encoding utf8 -Append

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
  $node = $nodeCommand.Source
} elseif (Test-Path $bundledNode) {
  $node = $bundledNode
} else {
  throw "Node.js bulunamadı. Node.js kurun veya Codex paketli çalışma zamanını kullanın."
}

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if ($pythonCommand) {
  $env:PYTHON_BIN = $pythonCommand.Source
} elseif (Test-Path $bundledPython) {
  $env:PYTHON_BIN = $bundledPython
}

Set-Location $root
"Kullanilan Node: $node" | Out-File -FilePath $logPath -Encoding utf8 -Append
"Kullanilan Python: $env:PYTHON_BIN" | Out-File -FilePath $logPath -Encoding utf8 -Append
& $node server.js
