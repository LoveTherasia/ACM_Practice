$cli = "$env:LOCALAPPDATA\Programs\@opencodedesktop\resources\opencode-cli.exe"
$ws = "E:\ACM_Practice\OpenCode\workspaces\manual-test"
New-Item -ItemType Directory -Force -Path $ws | Out-Null
Set-Content -Path "$ws\task.md" -Value "Create two files in the current directory: hello.txt (content: hello world) and data/config.json (a JSON with a name field). When done, reply only DONE."
$sw = [Diagnostics.Stopwatch]::StartNew()
$out = & $cli run --standalone --auto --format json --model opencode/space-bunny-free --agent build --file "$ws\task.md" "Read the attached task instructions, then create and edit files directly in the current working directory to complete it. When done, reply only one line: DONE. Do not output file contents in your reply." 2>&1
$sw.Stop()
$log = @()
$log += "elapsed: $($sw.Elapsed.TotalSeconds)s"
$log += "files:"
Get-ChildItem $ws -Recurse -File | ForEach-Object { $log += "  " + $_.FullName.Replace($ws, "") }
$text = $out | Select-String '"type":"text"'
foreach ($t in $text) { $log += "text: " + $t.Line.Substring(0, [Math]::Min(200, $t.Line.Length)) }
$log | Out-File -FilePath verify-logs\direct-write-test.log -Encoding utf8
