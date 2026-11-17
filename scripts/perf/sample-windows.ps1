param([Parameter(Mandatory=$true)][int]$RootPid,[int]$Seconds=60,[int]$IntervalMs=1000,[string]$Output)
$ErrorActionPreference='Stop'
if($Seconds -lt 0 -or $IntervalMs -lt 250){throw 'Invalid sampling duration or interval'}
$taskRoot=Get-Process -Id $RootPid -ErrorAction Stop
$taskStarted=$taskRoot.StartTime.ToUniversalTime()
$taskSamples=[Collections.Generic.List[object]]::new();$taskClock=[Diagnostics.Stopwatch]::StartNew()
do {
 $taskRoot=Get-Process -Id $RootPid -ErrorAction Stop
 if($taskRoot.StartTime.ToUniversalTime() -ne $taskStarted){throw 'Application process identity changed during capture'}
 $taskAll=@(Get-CimInstance Win32_Process);$taskIds=[Collections.Generic.HashSet[int]]::new();[void]$taskIds.Add($RootPid)
 do{$taskAdded=$false;foreach($taskProcess in $taskAll){if($taskIds.Contains([int]$taskProcess.ParentProcessId)-and $taskIds.Add([int]$taskProcess.ProcessId)){$taskAdded=$true}}}while($taskAdded)
 $taskRows=@(foreach($taskProcess in $taskAll|Where-Object{$taskIds.Contains([int]$_.ProcessId)}){
  $taskNative=Get-Process -Id $taskProcess.ProcessId -ErrorAction SilentlyContinue
  if($taskNative){$taskRole=if($taskProcess.ProcessId -eq $RootPid){'rust'}elseif($taskProcess.Name -eq 'conhost.exe'){'console'}elseif($taskProcess.CommandLine -match '--type=([^ ]+)'){$Matches[1]}else{'browser'}
   [pscustomobject]@{role=$taskRole;privateBytes=$taskNative.PrivateMemorySize64;workingBytes=$taskNative.WorkingSet64;cpuSeconds=$taskNative.CPU;handles=$taskNative.HandleCount;threads=$taskNative.Threads.Count}
  }
 })
 $taskDedicated=$null;$taskShared=$null;$taskEngines=@();$taskGpuError=$null
 try{
  $taskGpu=(Get-Counter -Counter '\GPU Process Memory(*)\Dedicated Usage','\GPU Process Memory(*)\Shared Usage','\GPU Engine(*)\Utilization Percentage' -MaxSamples 1 -ErrorAction Stop).CounterSamples|Where-Object{$_.InstanceName -match '^pid_(\d+)_' -and $taskIds.Contains([int]$Matches[1])}
  $taskDedicated=($taskGpu|Where-Object Path -like '*\dedicated usage'|Measure-Object CookedValue -Sum).Sum
  $taskShared=($taskGpu|Where-Object Path -like '*\shared usage'|Measure-Object CookedValue -Sum).Sum
  $taskEngines=@($taskGpu|Where-Object Path -like '*\utilization percentage'|ForEach-Object{[pscustomobject]@{engine=($_.InstanceName -replace '^pid_\d+_','');percent=$_.CookedValue}})
 }catch{$taskGpuError='GPU performance counters unavailable'}
 $taskAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
 $taskSamples.Add([pscustomobject]@{at=$taskAt;elapsedMs=$taskClock.ElapsedMilliseconds;privateBytes=($taskRows|Measure-Object privateBytes -Sum).Sum;workingBytes=($taskRows|Measure-Object workingBytes -Sum).Sum;cpuSeconds=($taskRows|Measure-Object cpuSeconds -Sum).Sum;handles=($taskRows|Measure-Object handles -Sum).Sum;threads=($taskRows|Measure-Object threads -Sum).Sum;roles=@($taskRows|Group-Object role|ForEach-Object{[pscustomobject]@{role=$_.Name;count=$_.Count;privateBytes=($_.Group|Measure-Object privateBytes -Sum).Sum;workingBytes=($_.Group|Measure-Object workingBytes -Sum).Sum}});gpuDedicatedBytes=$taskDedicated;gpuSharedBytes=$taskShared;gpuEngines=$taskEngines;gpuError=$taskGpuError})
 if($taskClock.Elapsed.TotalSeconds -ge $Seconds){break};Start-Sleep -Milliseconds $IntervalMs
}while($true)
$taskResult=[ordered]@{version=1;rootPid=$RootPid;startedAt=$taskStarted.ToString('o');durationMs=$taskClock.ElapsedMilliseconds;cpuUnit='percent of one logical core, computed from consecutive CPU/wall time deltas';gpuUnit='per-process engine counters; shared allocations are not deduplicated VRAM';samples=@($taskSamples)}
$taskJson=$taskResult|ConvertTo-Json -Depth 8
if($Output){$taskAbsolute=[IO.Path]::GetFullPath($Output);[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($taskAbsolute))|Out-Null;[IO.File]::WriteAllText($taskAbsolute,$taskJson,[Text.UTF8Encoding]::new($false))}else{$taskJson}
