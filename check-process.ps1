$processes = Get-CimInstance Win32_Process -Filter "Name='node.exe'";
foreach ($p in $processes) {
  Write-Output "PID: $($p.ProcessId)  CommandLine: $($p.CommandLine)";
}
