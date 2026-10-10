$cli = "$env:LOCALAPPDATA\Programs\@opencodedesktop\resources\opencode-cli.exe"
$sw = [Diagnostics.Stopwatch]::StartNew()
$out = & $cli run --standalone --auto --format json --model opencode/space-bunny-free --agent plan "Please write a Chinese technical article of about 8000 characters on greedy algorithms in competitive programming, with several complete C++ code examples. Output the article body directly, no explanations." 2>&1
$sw.Stop()
$log = @()
$log += "elapsed_seconds: $($sw.Elapsed.TotalSeconds)"
$text = $out | Select-String '"type":"text"'
$log += "text_events: $($text.Count)"
$sum = ($text | ForEach-Object { $_.Line.Length } | Measure-Object -Sum).Sum
$log += "total_chars: $sum"
$perm = $out | Select-String '"type":"permission"'
$log += "permission_events: $($perm.Count)"
$log | Out-File -FilePath verify-logs\longform-test2.log -Encoding utf8
