param([Parameter(Mandatory=$true)][string]$App)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'This smoke check is restricted to a fresh CI runner.' }
$env:PSModulePath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\Modules"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CourseWatchWindowStyle {
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr window, int index);
}
'@
$diagnostics = Join-Path (Get-Location) 'build/windows-diagnostics'
$null = New-Item -ItemType Directory -Path $diagnostics -Force
$samples = New-Object System.Collections.Generic.List[object]
function Get-AppProcesses([int]$RootId) {
  $all = @(Get-CimInstance Win32_Process)
  $ids = New-Object 'System.Collections.Generic.HashSet[int]'
  $null = $ids.Add($RootId)
  do {
    $changed = $false
    foreach ($item in $all) {
      if ($ids.Contains([int]$item.ParentProcessId) -and $ids.Add([int]$item.ProcessId)) { $changed = $true }
    }
  } while ($changed)
  @(Get-Process -Id @($ids) -ErrorAction SilentlyContinue)
}
function Measure-AppResources([string]$Phase) {
  $before = @{}
  foreach ($item in @(Get-AppProcesses $process.Id)) { $before[$item.Id] = $item.TotalProcessorTime.TotalMilliseconds }
  $watch = [Diagnostics.Stopwatch]::StartNew()
  Start-Sleep -Milliseconds 3000
  $items = @(Get-AppProcesses $process.Id)
  $watch.Stop()
  $cpu = 0.0
  $details = @($items | ForEach-Object {
    if ($before.ContainsKey($_.Id)) { $cpu += [Math]::Max(0, $_.TotalProcessorTime.TotalMilliseconds - $before[$_.Id]) }
    @{ pid = $_.Id; name = $_.ProcessName; workingSetBytes = $_.WorkingSet64; privateBytes = $_.PrivateMemorySize64; handles = $_.HandleCount }
  })
  $sample = @{
    phase = $Phase; sampledAt = [DateTime]::UtcNow.ToString('o'); durationMs = $watch.Elapsed.TotalMilliseconds
    processCount = $items.Count; processes = $details
    workingSetBytes = ($items | Measure-Object -Property WorkingSet64 -Sum).Sum
    privateBytes = ($items | Measure-Object -Property PrivateMemorySize64 -Sum).Sum
    cpuSingleCorePercent = 100 * $cpu / $watch.Elapsed.TotalMilliseconds
    logicalProcessorCount = [Environment]::ProcessorCount
  }
  $samples.Add($sample)
  Write-Host ("Resources ({0}): {1:N1} MiB working set, {2:N1} MiB private bytes, {3:N2}% of one core" -f $Phase, ($sample.workingSetBytes / 1MB), ($sample.privateBytes / 1MB), $sample.cpuSingleCorePercent)
}
$data = Join-Path $env:LOCALAPPDATA 'CourseWatch'
if (Test-Path $data) { throw 'Expected an empty CI user data directory.' }
$executable = Join-Path (Resolve-Path $App) 'CourseWatch.exe'
# Check rejection in the same fresh runner before exercising the accepted app.
$rejected = Start-Process -FilePath $executable -PassThru
try {
  $rejectedCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $rejected.Id)
  $quitName = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '退出软件')
  $quitButton = $null
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $rejectedWindow = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $rejectedCondition)
    if ($rejectedWindow) { $quitButton = $rejectedWindow.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $quitName) }
    if ($quitButton) { break }
    if ($rejected.HasExited) { throw 'Desktop exited before the agreement dialog.' }
    Start-Sleep -Milliseconds 500
  }
  if (!$quitButton) { throw 'First launch did not offer rejecting the agreement.' }
  foreach ($text in @('本软件完全免费。', '如果你是在其他付费渠道获取此软件，请立即退款并举报该商家。', '项目源码地址：https://github.com/BeifengFlying/CourseWatch', '用户协议全文')) {
    $named = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $text)
    $control = $rejectedWindow.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $named)
    if (!$control -or $control.Current.IsOffscreen) { throw "Consent text unavailable: $text" }
  }
  if (Test-Path (Join-Path $data 'service.pid')) { throw 'Backend started before agreement acceptance.' }
  Add-Type -AssemblyName System.Drawing
  $rectangle = $rejectedWindow.Current.BoundingRectangle
  $bitmap = New-Object System.Drawing.Bitmap ([int]$rectangle.Width), ([int]$rectangle.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen([int]$rectangle.Left, [int]$rectangle.Top, 0, 0, $bitmap.Size)
    $bitmap.Save((Join-Path $diagnostics 'first-run-consent.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
  $quitButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  if (!$rejected.WaitForExit(5000)) { throw 'Rejecting the agreement did not exit the application.' }
  if ((Test-Path (Join-Path $data 'user-agreement.json')) -or (Test-Path (Join-Path $data 'service.pid'))) { throw 'Rejection left acceptance or a running backend.' }
  Write-Host 'First launch: free notice, refund warning, repository, full terms and rejection passed.'
} finally { if (!$rejected.HasExited) { Stop-Process -Id $rejected.Id -Force -ErrorAction SilentlyContinue } }
$process = Start-Process -FilePath $executable -PassThru
$backendPid = $null
try {
  $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
  $heading = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '待办事项')
  $closeName = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '关闭窗口')
  $minimizeName = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '最小化窗口')
  $shell = New-Object -ComObject WScript.Shell
  $loaded = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ($process.HasExited) { throw "Desktop exited before loading: $($process.ExitCode)" }
    $null = $shell.AppActivate($process.Id)
    $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    if ($window) {
      $consentName = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '同意并继续')
      $consent = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $consentName)
      if ($consent) {
        if (Test-Path (Join-Path $data 'service.pid')) { throw 'Backend started before agreement acceptance.' }
        $consent.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        Start-Sleep -Milliseconds 300
        continue
      }
      $setupName = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '保存设置')
      $setup = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $setupName)
      if ($setup) { $setup.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Milliseconds 300 }
    }
    if ($window -and $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $heading)) { $loaded = $true; break }
    Start-Sleep -Milliseconds 1000
  }
  if (!$loaded) {
    if ($window) {
      $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      foreach ($element in $elements) { Write-Host $element.Current.Name }
    }
    throw 'Packaged WebView2 did not expose the task page within 60 seconds.'
  }
  Write-Host 'Packaged Windows desktop: WebView2 task page loaded.'
  $handle = [IntPtr]$window.Current.NativeWindowHandle
  $style = [CourseWatchWindowStyle]::GetWindowLong($handle, -16)
  if (($style -band 0x00C00000) -ne 0) { throw 'The native caption is visible above the shared titlebar.' }
  if (($style -band 0x00010000) -ne 0) { throw 'The main window exposes native maximize.' }
  if (($style -band 0x00040000) -ne 0) { throw 'The fixed window exposes a native resize frame.' }
  foreach ($name in @('全部任务', '我的日程', '设置')) {
    $named = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
    $button = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $named)
    if (!$button -or $button.Current.IsOffscreen) { throw "Sidebar control is unavailable: $name" }
    $bounds = $button.Current.BoundingRectangle
    $frame = $window.Current.BoundingRectangle
    if ($bounds.Top -lt $frame.Top -or $bounds.Bottom -gt $frame.Bottom) { throw "Sidebar control is clipped: $name" }
  }
  $backendPid = [int](Get-Content (Join-Path $data 'service.pid'))
  Measure-AppResources 'visible-idle'
  $minimize = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $minimizeName)
  if (!$minimize) { throw 'Minimize button unavailable.' }
  $minimize.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  Start-Sleep -Milliseconds 2000
  $windowPattern = $window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
  if ($windowPattern.Current.WindowVisualState -ne [System.Windows.Automation.WindowVisualState]::Minimized) { throw 'Minimize did not minimize to the taskbar.' }
  if (!(Get-Process -Id $backendPid -ErrorAction SilentlyContinue)) { throw 'Minimizing stopped the backend.' }
  Measure-AppResources 'minimized'
  $activate = Start-Process -FilePath $executable -PassThru
  if (!$activate.WaitForExit(5000) -or $activate.ExitCode -ne 0) { throw 'Single-instance restore failed.' }
  $restored = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $null = $shell.AppActivate($process.Id)
    $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    if ($window -and $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $heading)) { $restored = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (!$restored) { throw 'Task page did not restore after minimizing.' }
  $close = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $closeName)
  if (!$close) { throw 'Close button unavailable.' }
  $invoke = $close.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $invoke.Invoke()
  $trayChoiceName = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '隐藏到系统托盘')
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $trayChoice = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $trayChoiceName)
    if ($trayChoice) { $trayChoice.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); break }
    Start-Sleep -Milliseconds 100
  }
  if (!$trayChoice) { throw 'The first close did not offer hiding to the system tray.' }
  Start-Sleep -Milliseconds 1500
  if ($process.HasExited -or !(Get-Process -Id $backendPid -ErrorAction SilentlyContinue)) { throw 'Closing the main window stopped the desktop or backend.' }
  Measure-AppResources 'closed-to-tray'
  $quit = Start-Process -FilePath $executable -ArgumentList '--quit' -PassThru
  if (!$quit.WaitForExit(20000) -or $quit.ExitCode -ne 0) { throw 'Single-instance quit request failed.' }
  if (!$process.WaitForExit(5000)) { throw 'Desktop did not quit.' }
  if (Get-Process -Id $backendPid -ErrorAction SilentlyContinue) { throw 'Backend remained after desktop exit.' }
  if (Test-Path (Join-Path $data 'service.lock')) { throw 'Backend lock remained after graceful exit.' }
  if (!(Test-Path (Join-Path $data 'user-agreement.json'))) { throw 'Acceptance receipt was not persisted.' }
  $process = Start-Process -FilePath $executable -PassThru
  $resumed = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
    $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    if ($window) {
      $consentName = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '同意并继续')
      if ($window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $consentName)) { throw 'Accepted restart repeated the agreement.' }
      if ($window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $heading)) { $resumed = $true; break }
    }
    if ($process.HasExited) { throw 'Accepted restart exited before loading.' }
    Start-Sleep -Milliseconds 500
  }
  if (!$resumed) { throw 'Accepted restart did not restore the task page.' }
  $backendPid = [int](Get-Content (Join-Path $data 'service.pid'))
  $quit = Start-Process -FilePath $executable -ArgumentList '--quit' -PassThru
  if (!$quit.WaitForExit(20000) -or $quit.ExitCode -ne 0 -or !$process.WaitForExit(5000)) { throw 'Accepted restart did not quit cleanly.' }
  if (Get-Process -Id $backendPid -ErrorAction SilentlyContinue) { throw 'Restarted backend remained after quit.' }
  Write-Host 'Packaged Windows desktop: consent persistence, accepted restart, close-to-tray, single-instance quit and backend cleanup passed.'
} finally {
  @{ environment = 'GitHub Actions Windows runner'; data = 'empty database, no accounts or platform collection'; samples = $samples.ToArray(); energyMeasured = $false } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $diagnostics 'resources.json') -Encoding UTF8
  if (!$process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 1500 }
  if ($backendPid -and (Get-Process -Id $backendPid -ErrorAction SilentlyContinue)) { Stop-Process -Id $backendPid -Force -ErrorAction SilentlyContinue }
  $unregister = Start-Process -FilePath $executable -ArgumentList '--unregister-notifications' -PassThru
  if (!$unregister.WaitForExit(5000)) { Stop-Process -Id $unregister.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $data -Recurse -Force -ErrorAction SilentlyContinue
}
