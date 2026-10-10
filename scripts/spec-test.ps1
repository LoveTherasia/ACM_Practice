$cli = "$env:LOCALAPPDATA\Programs\@opencodedesktop\resources\opencode-cli.exe"
$ws = "E:\ACM_Practice\OpenCode\workspaces\spec-test"
if (Test-Path $ws) { Remove-Item $ws -Recurse -Force }
New-Item -ItemType Directory -Force -Path $ws | Out-Null
# Copy the real architect spec
Copy-Item "E:\ACM_Practice\OpenCode\specs\architect.md" "$ws\.task-spec.md"
Add-Content "$ws\.task-spec.md" @"

---

# TASK

Category: greedy. Difficulty: easy. Premise: interval scheduling - n tasks with start/end times, one machine, maximize completed tasks, n <= 2e5.

Produce these three files (config.json exists as a template - REWRITE it completely; meta.json does not exist - CREATE it):
- config.json
- docs/statement.md
- meta.json
"@
Push-Location $ws
$out = & $cli run --standalone --auto --format json --model opencode/space-bunny-free --agent build "First read the file .task-spec.md in the current directory - it is your complete task specification. Then follow it exactly: create and edit files directly in the current working directory. When done, reply only DONE." 2>&1
Pop-Location
$log = @()
$log += "files after:"
Get-ChildItem $ws -Recurse -File | ForEach-Object { $log += "  " + $_.FullName.Replace($ws, "") + " (" + $_.Length + " bytes)" }
$tools = $out | Select-String '"type":"tool_use"'
$log += "tool_use events: $($tools.Count)"
foreach ($t in $tools) {
  if ($t.Line -match '"tool":"([^"]+)"') { $log += "  tool: " + $Matches[1] }
}
$texts = $out | Select-String '"type":"text"'
foreach ($t in $texts) {
  $line = $t.Line
  if ($line -match '"text":"([^"]{0,150})') { $log += "text: " + $Matches[1] }
}
$log | Out-File -FilePath verify-logs\spec-test.log -Encoding utf8
