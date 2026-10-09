// ACM Practice launcher.
//
// A tiny WinForms tray-less launcher that:
//   1. checks Node.js >= 20 and npm are on PATH
//   2. installs dependencies on first run (node_modules missing)
//   3. starts `npm run dev` on a free port
//   4. waits for the server to answer, then opens the browser
//
// Built with the .NET Framework C# compiler that ships with Windows, so no
// SDK install is needed to produce ACMPractice.exe.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

static class Program
{
    [STAThread]
    static int Main()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string debugLog = Path.Combine(root, "launcher-debug.log");
        Action<string> debug = delegate(string msg)
        {
            try
            {
                // 每次启动重写日志，避免无限增长。
                bool first = !File.Exists(debugLog);
                File.AppendAllText(debugLog,
                    DateTime.Now.ToString("HH:mm:ss.fff") + " " + msg + Environment.NewLine);
                if (first)
                {
                    // nothing extra; the flag only documents intent
                }
            }
            catch { /* logging is best-effort */ }
        };

        // Truncate the previous run's log so it stays one-run-scoped.
        try { File.Delete(debugLog); } catch { }

        debug("=== 启动器开始 ===");
        debug("exe 目录: " + root);
        // The exe may sit in the repo root; resolve the project root by
        // looking for package.json here or one level up.
        if (!File.Exists(Path.Combine(root, "package.json")))
        {
            string up = Path.GetFullPath(Path.Combine(root, ".."));
            if (File.Exists(Path.Combine(up, "package.json")))
            {
                root = up;
            }
        }

        debug("项目根目录: " + root);

        if (!File.Exists(Path.Combine(root, "package.json")))
        {
            MessageBox.Show(
                "没有在 exe 附近找到 package.json。\n请把 ACMPractice.exe 放在项目根目录（E:\\ACM_Practice）后运行。",
                "ACM Practice",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }

        string node = FindOnPath("node.exe");
        debug("node 路径: " + (node ?? "(未找到)"));
        if (node == null)
        {
            MessageBox.Show(
                "未找到 Node.js。请安装 Node.js 20 或更高版本：\nhttps://nodejs.org/",
                "ACM Practice",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }

        if (!CheckNodeVersion(node))
        {
            debug("Node 版本检查失败");
            MessageBox.Show(
                "Node.js 版本过低，本项目需要 20.9 或更高版本。",
                "ACM Practice",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }

        // First run: install dependencies.
        if (!Directory.Exists(Path.Combine(root, "node_modules")))
        {
            var installForm = new ConsoleForm("正在安装依赖（首次运行需要几分钟）…");
            var installThread = new Thread(() =>
            {
                // 国内网络直连 npm registry 可能极慢，走 npmmirror 镜像。
                // npm-cli.js 用绝对路径：node 按工作目录解析相对路径。
                string npmCli = Path.Combine(
                    Path.GetDirectoryName(node), "node_modules", "npm", "bin", "npm-cli.js");
                int code = RunCommand(node,
                    "\"" + npmCli + "\" install --no-audit --no-fund --registry=https://registry.npmmirror.com",
                    root, null);
                installForm.Finish(code == 0
                    ? "依赖安装完成。"
                    : "依赖安装失败，请手动运行 npm install 查看错误。");
            });
            installThread.IsBackground = true;
            Application.Run(installForm);
            if (!installForm.Success)
            {
                return 1;
            }
        }

        // Pick a free port, preferring the conventional ones.
        int port = FindFreePort(3210) ?? FindFreePort(3000) ?? 3210;
        debug("选定端口: " + port);

        var serverForm = new ConsoleForm(null);
        var serverThread = new Thread(() =>
        {
            try
            {
                // npm-cli.js 必须用绝对路径：node 按工作目录解析相对路径，
                // 而工作目录是项目根目录，那里没有 npm-cli.js。
                string npmCli = Path.Combine(
                    Path.GetDirectoryName(node), "node_modules", "npm", "bin", "npm-cli.js");
                if (!File.Exists(npmCli))
                {
                    debug("找不到 npm-cli.js: " + npmCli);
                    serverForm.Finish("找不到 npm（" + npmCli + "）。请确认 Node.js 安装完整。");
                    return;
                }

                var psi = new ProcessStartInfo
                {
                    FileName = node,
                    // --port 显式指定端口，避免被系统 PORT 环境变量（如 8080）抢占。
                    Arguments = "\"" + npmCli + "\" run dev -- --port " + port,
                    WorkingDirectory = root,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                debug("启动命令: " + psi.FileName + " " + psi.Arguments);
                var process = Process.Start(psi);
                if (process == null)
                {
                    debug("Process.Start 返回 null");
                    serverForm.Finish("无法启动开发服务器。");
                    return;
                }
                debug("服务器进程 PID: " + process.Id);
                serverForm.Attach(process);

            // Pump output into the log window.
            var pump = new Thread(() =>
            {
                string line;
                while ((line = process.StandardOutput.ReadLine()) != null)
                {
                    serverForm.AppendLine(line);
                }
            });
            pump.IsBackground = true;
            pump.Start();
            var pumpErr = new Thread(() =>
            {
                string line;
                while ((line = process.StandardError.ReadLine()) != null)
                {
                    serverForm.AppendLine(line);
                }
            });
            pumpErr.IsBackground = true;
            pumpErr.Start();

            // Wait for the server to answer, then open the browser.
            //
            // CRITICAL: probe 127.0.0.1, never "localhost". Next.js binds
            // IPv6 (::) only on some machines, and "localhost" resolves to
            // IPv4 there, so a localhost probe would never succeed and the
            // browser would never open even though the server is fine.
            string url = string.Format("http://127.0.0.1:{0}/", port);
            string displayUrl = string.Format("http://localhost:{0}/", port);
            debug("开始探测: " + url);
            if (WaitForServer(url, 120000))
            {
                debug("探测成功，打开浏览器");
                serverForm.AppendLine(string.Format("已就绪：{0}（正在打开浏览器…）", displayUrl));
                try { Process.Start(new ProcessStartInfo(displayUrl) { UseShellExecute = true }); }
                catch (Exception ex) { debug("打开浏览器失败: " + ex.Message); }
            }
            else
            {
                debug("探测超时");
                serverForm.AppendLine("服务器启动超时，请查看上方日志。");
            }
            }
            catch (Exception ex)
            {
                debug("服务器线程异常: " + ex);
                serverForm.AppendLine("启动异常: " + ex.Message);
            }
        });
        serverThread.IsBackground = true;
        serverThread.Start();

        Application.Run(serverForm);

        serverForm.KillServer();
        return 0;
    }

    static string FindOnPath(string name)
    {
        var pathVar = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string dir in pathVar.Split(';'))
        {
            if (string.IsNullOrWhiteSpace(dir)) continue;
            try
            {
                string candidate = Path.Combine(dir.Trim(), name);
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }
            catch { /* unreadable PATH entry */ }
        }
        return null;
    }

    static bool CheckNodeVersion(string node)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = node,
                Arguments = "-e process.stdout.write(process.versions.node)",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
            };
            var p = Process.Start(psi);
            string version = p.StandardOutput.ReadToEnd().Trim();
            p.WaitForExit(10000);
            var parts = version.Split('.');
            int major = int.Parse(parts[0]);
            return major >= 20;
        }
        catch
        {
            return false;
        }
    }

    static int RunCommand(string node, string args, string cwd, string port)
    {
        // args 里的 npm-cli.js 已由调用方解析为绝对路径。
        var psi = new ProcessStartInfo
        {
            FileName = node,
            Arguments = args,
            WorkingDirectory = cwd,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        if (port != null) psi.EnvironmentVariables["PORT"] = port;
        var p = Process.Start(psi);
        p.WaitForExit();
        return p.ExitCode;
    }

    static int? FindFreePort(int preferred)
    {
        var listener = new TcpListener(IPAddress.Loopback, preferred);
        try
        {
            listener.Start();
            listener.Stop();
            return preferred;
        }
        catch
        {
            return null;
        }
    }

    static bool WaitForServer(string url, int timeoutMs)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(url);
                request.AllowAutoRedirect = false;
                request.Timeout = 3000;
                // 本机探测绝不能走系统代理：代理会拦截 127.0.0.1 请求，
                // 导致服务器明明就绪却探测失败。
                request.Proxy = null;
                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    if ((int)response.StatusCode >= 200 && (int)response.StatusCode < 500)
                    {
                        return true;
                    }
                }
            }
            catch (WebException we)
            {
                var response = we.Response as HttpWebResponse;
                if (response != null && (int)response.StatusCode < 500)
                {
                    return true;
                }
            }
            catch { /* not up yet */ }
            Thread.Sleep(1000);
        }
        return false;
    }
}

/// <summary>
/// A small always-on-top log window. For the install phase it closes itself
/// when the install finishes; for the server phase it stays open and the
/// server process is killed when the window closes.
/// </summary>
public class ConsoleForm : Form
{
    private readonly TextBox _log;
    private readonly Button _close;
    private Process _server;
    public bool Success;

    public ConsoleForm(string autoCloseMessage)
    {
        Text = "ACM Practice · 出题控制台";
        Width = 780;
        Height = 480;
        StartPosition = FormStartPosition.CenterScreen;

        _log = new TextBox
        {
            Multiline = true,
            ScrollBars = ScrollBars.Vertical,
            ReadOnly = true,
            Dock = DockStyle.Fill,
            Font = new System.Drawing.Font("Consolas", 9F),
            BackColor = System.Drawing.Color.FromArgb(24, 24, 27),
            ForeColor = System.Drawing.Color.FromArgb(228, 228, 231),
        };

        _close = new Button
        {
            Text = "停止并退出",
            Dock = DockStyle.Bottom,
            Height = 40,
        };
        _close.Click += (s, e) => Close();

        Controls.Add(_log);
        Controls.Add(_close);

        if (autoCloseMessage != null)
        {
            AppendLine(autoCloseMessage);
        }
        else
        {
            AppendLine("正在启动 ACM Practice 开发服务器…");
        }

        FormClosed += (s, e) => KillServer();
    }

    public void Attach(Process server)
    {
        _server = server;
    }

    public void AppendLine(string line)
    {
        if (InvokeRequired)
        {
            BeginInvoke((MethodInvoker)delegate { AppendLine(line); });
            return;
        }
        _log.AppendText(line + Environment.NewLine);
    }

    public void Finish(string message)
    {
        if (InvokeRequired)
        {
            BeginInvoke((MethodInvoker)delegate { Finish(message); });
            return;
        }
        Success = message != null && message.Contains("完成");
        AppendLine(message);
        if (Success)
        {
            // Auto-close after a successful install so the server phase starts.
            var timer = new System.Windows.Forms.Timer { Interval = 800 };
            timer.Tick += (s, e) => { timer.Stop(); Close(); };
            timer.Start();
        }
    }

    public void KillServer()
    {
        try
        {
            if (_server != null && !_server.HasExited)
            {
                // npm spawns children; kill the whole tree.
                KillTree(_server.Id);
            }
        }
        catch { /* already gone */ }
    }

    static void KillTree(int pid)
    {
        // taskkill /T walks the process tree, which is the reliable way on
        // Windows to stop npm -> node -> next dev in one shot.
        var psi = new ProcessStartInfo
        {
            FileName = "taskkill",
            Arguments = string.Format("/PID {0} /T /F", pid),
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        var killer = Process.Start(psi);
        if (killer != null)
        {
            killer.WaitForExit(5000);
        }
    }
}
