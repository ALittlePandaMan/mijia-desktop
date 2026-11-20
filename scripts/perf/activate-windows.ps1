param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference='Stop'
$taskExe=[IO.Path]::GetFullPath($Executable)
if(-not(Test-Path -LiteralPath $taskExe -PathType Leaf)){throw 'Application executable unavailable'}
Start-Process -FilePath $taskExe -WorkingDirectory ([IO.Path]::GetDirectoryName($taskExe)) -WindowStyle Hidden|Out-Null
