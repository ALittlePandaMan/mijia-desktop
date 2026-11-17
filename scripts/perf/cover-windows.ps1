param([int]$Monitor=0,[int]$Seconds=240,[switch]$Partial,[string]$CloseSignalPath)
# A test-owned opaque window; never changes resolution, foreground app state or desktop settings.
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class ResourceTestDpi{[DllImport("user32.dll")]public static extern bool SetProcessDpiAwarenessContext(IntPtr value);[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr window,int command);[DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr window,IntPtr insertAfter,int x,int y,int width,int height,uint flags);}'
[void][ResourceTestDpi]::SetProcessDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$taskScreens=[Windows.Forms.Screen]::AllScreens
if($Monitor -lt 0 -or $Monitor -ge $taskScreens.Count){throw 'Test monitor unavailable'}
$taskForm=[Windows.Forms.Form]::new();$taskForm.Text='米家资源测试 · 遮挡窗口';$taskForm.FormBorderStyle=[Windows.Forms.FormBorderStyle]::None;$taskForm.StartPosition=[Windows.Forms.FormStartPosition]::Manual;$taskForm.BackColor=[Drawing.Color]::FromArgb(32,40,56);$taskForm.Bounds=$taskScreens[$Monitor].Bounds;$taskForm.TopMost=$true
if($Partial){$taskForm.Width=[int]($taskForm.Width/2)}
$taskLabel=[Windows.Forms.Label]::new();$taskLabel.Text='资源测试：不透明窗口遮挡';$taskLabel.ForeColor=[Drawing.Color]::White;$taskLabel.Font=[Drawing.Font]::new('Microsoft YaHei',18);$taskLabel.AutoSize=$true;$taskLabel.Location=[Drawing.Point]::new(40,40);$taskForm.Controls.Add($taskLabel)
$taskClock=[Diagnostics.Stopwatch]::StartNew()
$script:resourceCoverShown=$false
$taskTimer=[Windows.Forms.Timer]::new();$taskTimer.Interval=250;$taskTimer.add_Tick({if(-not $script:resourceCoverShown){$script:resourceCoverShown=$true;[void][ResourceTestDpi]::ShowWindow($taskForm.Handle,5);[void][ResourceTestDpi]::SetWindowPos($taskForm.Handle,[IntPtr](-1),0,0,0,0,0x43)};if($taskClock.Elapsed.TotalSeconds -ge $Seconds -or ($CloseSignalPath -and [IO.File]::Exists($CloseSignalPath))){$taskForm.Close()}});$taskTimer.Start()
$taskForm.add_Shown({[Console]::WriteLine('Cover visible: '+$taskForm.Visible+' bounds: '+$taskForm.Bounds.ToString())})
try{[Windows.Forms.Application]::Run($taskForm)}finally{$taskTimer.Dispose();$taskForm.Dispose()}
