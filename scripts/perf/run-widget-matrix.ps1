param(
 [Parameter(Mandatory)][string]$Executable,
 [Parameter(Mandatory)][string]$Fixture,
 [Parameter(Mandatory)][string]$Output,
 [ValidateSet('all','visible','covered')][string]$Modes='all',
 [int]$Seconds=30,
 [switch]$AllowLayoutChanges
)
# App-owned IPC only. The original layout is restored byte for byte after shutdown.
$ErrorActionPreference='Stop'
if(-not $AllowLayoutChanges){throw 'Pass -AllowLayoutChanges with a private fixture to enable reversible layout changes.'}
Set-Location -LiteralPath (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)
$taskExecutable=(Resolve-Path -LiteralPath $Executable).Path
$taskFixture=(Resolve-Path -LiteralPath $Fixture).Path
$taskOutput=[IO.Path]::GetFullPath($Output)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($taskOutput))|Out-Null
$taskLayout=Join-Path $env:LOCALAPPDATA 'io.mijiadesktop.client/desktop-widgets-v1.json'
$taskBackup=$taskOutput+'.private-layout-backup'
function Stop-MatrixApp {
 foreach($taskProcess in @(Get-Process -Name mijia-desktop -ErrorAction SilentlyContinue)){
  if($taskProcess.Path -ne $taskExecutable){throw 'A different application build is running; stop it normally before testing.'}
  Start-Process -FilePath $taskExecutable -ArgumentList '--quit' -WindowStyle Hidden|Out-Null
  if(-not $taskProcess.WaitForExit(30000)){throw 'Normal application shutdown failed.'}
 }
 Start-Sleep -Seconds 2
}
function Start-MatrixApp {
 $taskPrevious=$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
 $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9442 --remote-debugging-address=127.0.0.1'
 try{$script:matrixProcess=Start-Process -FilePath $taskExecutable -WorkingDirectory ([IO.Path]::GetDirectoryName($taskExecutable)) -WindowStyle Hidden -PassThru}finally{$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=$taskPrevious}
 Start-Sleep -Seconds 3
 if($script:matrixProcess.HasExited){throw 'Application failed to start.'}
}
function Save-MatrixLayout([byte[]]$Bytes){
 $taskTemp=$taskLayout+'.'+[Guid]::NewGuid().ToString()+'.tmp'
 $taskStream=[IO.File]::Open($taskTemp,[IO.FileMode]::CreateNew)
 try{$taskStream.Write($Bytes,0,$Bytes.Length);$taskStream.Flush($true)}finally{$taskStream.Dispose()}
 [IO.File]::Move($taskTemp,$taskLayout,$true)
}
Stop-MatrixApp
$taskOriginal=[IO.File]::ReadAllBytes($taskLayout)
if(([Text.Encoding]::UTF8.GetString($taskOriginal)|ConvertFrom-Json).version -ne 1){throw 'Unknown layout format.'}
[IO.File]::WriteAllBytes($taskBackup,$taskOriginal)
$taskStarted=$false
try{
 Save-MatrixLayout ([Text.Encoding]::UTF8.GetBytes('{"version":1,"pins":{}}'))
 Start-MatrixApp;$taskStarted=$true
 & node scripts/perf/widget-matrix.mjs --fixture $taskFixture --exe $taskExecutable --pid $script:matrixProcess.Id --out $taskOutput --seconds $Seconds --modes $Modes --allow-layout-changes
 if($LASTEXITCODE -ne 0){throw 'Matrix failed; inspect the report and private backup.'}
}finally{
 if($taskStarted){Stop-MatrixApp}
 $taskCurrent=Get-Content -LiteralPath $taskLayout -Raw|ConvertFrom-Json
 if(@($taskCurrent.pins.PSObject.Properties).Count){throw 'Pins remain or an external layout edit occurred. Backup retained; automatic overwrite stopped.'}
 Save-MatrixLayout $taskOriginal
 Start-MatrixApp
 if((Get-FileHash -LiteralPath $taskLayout).Hash -ne (Get-FileHash -LiteralPath $taskBackup).Hash){throw 'Layout restoration verification failed.'}
 Write-Output ('Restored original layout; application PID '+$script:matrixProcess.Id)
}
