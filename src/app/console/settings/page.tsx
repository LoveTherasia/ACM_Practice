"use client";

import { CheckCircle, Lightning, XCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

/**
 * The LLM settings page.
 *
 * One page per provider preset (Section 4.5: full interactive cycles). The
 * presets carry the base URL and default model names so switching providers
 * is a click, not a documentation lookup. The API key is write-only: the
 * server returns a masked preview, never the secret.
 *
 * Below the provider form sits the local-model training panel: every
 * verified cloud generation is captured as a fine-tuning sample, and the
 * panel reports how close the corpus is to the recommended size.
 */

type TrainingStats = {
  files: number;
  samples: number;
  verified: number;
  ready: boolean;
  advice: string;
};

type Provider = "openai" | "anthropic" | "opencode";

type Preset = {
  id: string;
  label: string;
  provider: Provider;
  baseUrl: string;
  modelArchitect: string;
  modelWorker: string;
  hint: string;
};

const PRESETS: Preset[] = [
  {
    id: "openai",
    label: "OpenAI 官方",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    modelArchitect: "gpt-4.1",
    modelWorker: "gpt-4.1-mini",
    hint: "platform.openai.com 申请 key",
  },
  {
    id: "zhipu",
    label: "智谱 GLM（官方）",
    provider: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    modelArchitect: "glm-4.6",
    modelWorker: "glm-4.6",
    hint: "open.bigmodel.cn 获取 key；glm-4-flash 免费可先测试流程",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    provider: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    modelArchitect: "deepseek-reasoner",
    modelWorker: "deepseek-chat",
    hint: "platform.deepseek.com 申请 key，价格最低",
  },
  {
    id: "kimi",
    label: "Kimi / Moonshot",
    provider: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    modelArchitect: "kimi-k2-0905-preview",
    modelWorker: "kimi-k2-0905-preview",
    hint: "platform.moonshot.cn 申请 key",
  },
  {
    id: "qwen",
    label: "通义千问",
    provider: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelArchitect: "qwen-max",
    modelWorker: "qwen-plus",
    hint: "阿里云百炼申请 key",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    provider: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    modelArchitect: "anthropic/claude-sonnet-4.5",
    modelWorker: "anthropic/claude-sonnet-4.5",
    hint: "一个 key 聚合所有模型，格式为 厂商/模型名",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    modelArchitect: "claude-sonnet-4-5",
    modelWorker: "claude-sonnet-4-5",
    hint: "console.anthropic.com 申请 key",
  },
  {
    id: "custom",
    label: "自定义（任意 OpenAI 兼容）",
    provider: "openai",
    baseUrl: "",
    modelArchitect: "",
    modelWorker: "",
    hint: "vLLM / Ollama / 其他网关，填完整 base URL",
  },
  {
    id: "opencode",
    label: "本地 OpenCode",
    provider: "opencode",
    baseUrl: "",
    modelArchitect: "opencode/ling-3.1-flash-free",
    modelWorker: "opencode/ling-3.1-flash-free",
    hint: "调用本机已安装的 OpenCode CLI，用它自己的 provider 登录与配额；不需要在这里填 API key",
  },
];

type CurrentConfig = {
  configured: boolean;
  provider: Provider;
  baseUrl: string | null;
  anthropicBaseUrl: string | null;
  apiKeyMasked: string | null;
  anthropicKeyMasked: string | null;
  modelArchitect: string | null;
  modelWorker: string | null;
  opencodeModel: string | null;
  opencodeCli: string | null;
  maxOutputTokens: string | null;
  timeoutMs: string | null;
  runVerification: boolean;
};

export default function SettingsPage() {
  const [current, setCurrent] = useState<CurrentConfig | null>(null);
  const [presetId, setPresetId] = useState<string>("deepseek");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelArchitect, setModelArchitect] = useState("");
  const [modelWorker, setModelWorker] = useState("");
  const [opencodeCli, setOpencodeCli] = useState("");
  /** Models OpenCode can actually reach on this machine. */
  const [opencodeModels, setOpencodeModels] = useState<string[]>([]);
  const [opencodeModelsError, setOpencodeModelsError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [maxOutputTokens, setMaxOutputTokens] = useState("16000");
  const [timeoutMs, setTimeoutMs] = useState("600000");
  const [runVerification, setRunVerification] = useState(true);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"ok" | "err">("ok");
  const [training, setTraining] = useState<TrainingStats | null>(null);

  const notify = (kind: "ok" | "err", text: string) => {
    setMessageKind(kind);
    setMessage(text);
  };

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/llm");
      if (!response.ok) {
        return;
      }
      const config = (await response.json()) as CurrentConfig;
      setCurrent(config);
      setBaseUrl(
        (config.provider === "anthropic"
          ? config.anthropicBaseUrl
          : config.baseUrl) ?? "",
      );
      setModelArchitect(config.modelArchitect ?? "");
      setModelWorker(config.modelWorker ?? "");
      setOpencodeCli(config.opencodeCli ?? "");
      setMaxOutputTokens(config.maxOutputTokens ?? "16000");
      setTimeoutMs(config.timeoutMs ?? "600000");
      setRunVerification(config.runVerification);
    } catch {
      // The page still works without the current state.
    }
  }, []);

  useEffect(() => {
    void load();
    void (async () => {
      try {
        const response = await fetch("/api/settings/training");
        if (response.ok) {
          setTraining((await response.json()) as TrainingStats);
        }
      } catch {
        // The panel is informational only.
      }
    })();
  }, [load]);

  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]!;
  /**
   * OpenCode is delegated to a local CLI that owns its own provider logins, so
   * the base-URL/key fields do not apply to it - and showing them would invite
   * the user to enter credentials that nothing reads.
   */
  const isOpencode = preset.provider === "opencode";

  const applyPreset = (id: string) => {
    const next = PRESETS.find((p) => p.id === id);
    if (!next) {
      return;
    }
    setPresetId(id);
    if (next.baseUrl) {
      setBaseUrl(next.baseUrl);
    }
    if (next.modelArchitect) {
      setModelArchitect(next.modelArchitect);
    }
    if (next.modelWorker) {
      setModelWorker(next.modelWorker);
    }
    setMessage(null);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/llm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: preset.provider,
          baseUrl,
          apiKey: apiKey || undefined,
          modelArchitect,
          modelWorker,
          // OpenCode manages its own credentials, so it only needs the model id
          // and an optional CLI path.
          opencodeModel: preset.provider === "opencode" ? modelArchitect : undefined,
          opencodeCli: preset.provider === "opencode" ? opencodeCli : undefined,
          maxOutputTokens,
          timeoutMs,
          runVerification,
        }),
      });
      const payload = (await response.json()) as { error?: string; saved?: boolean };
      if (!response.ok) {
        notify("err", payload.error ?? `保存失败 HTTP ${response.status}`);
        return;
      }
      notify("ok", "已保存到 .env.local。请重启开发服务器（关闭 exe 窗口后重新双击）后生效。");
      setApiKey("");
      await load();
    } catch (e) {
      notify("err", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const loadOpencodeModels = async () => {
    setLoadingModels(true);
    setOpencodeModelsError(null);
    try {
      const response = await fetch("/api/settings/opencode-models");
      const payload = (await response.json()) as {
        ok: boolean;
        models: string[];
        error?: string;
        current?: string;
      };
      if (!payload.ok) {
        setOpencodeModelsError(payload.error ?? "无法读取 OpenCode 模型列表");
        setOpencodeModels([]);
        return;
      }
      setOpencodeModels(payload.models);
      if (payload.models.length === 0) {
        setOpencodeModelsError(
          "OpenCode 没有返回任何模型。请先运行 `opencode auth login` 登录一个 provider。",
        );
      }
    } catch (e) {
      setOpencodeModelsError((e as Error).message);
    } finally {
      setLoadingModels(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/llm", { method: "PUT" });
      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
        model?: string;
        reply?: string;
      };
      if (payload.ok) {
        notify("ok", `连接成功（${payload.model}）：${payload.reply ?? ""}`);
      } else {
        notify("err", payload.error ?? "连接失败");
      }
    } catch (e) {
      notify("err", (e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const keyMasked =
    current === null
      ? null
      : current.provider === "anthropic"
        ? current.anthropicKeyMasked
        : current.apiKeyMasked;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold leading-tight tracking-normal text-ink">
        模型配置
      </h1>
      <p className="mt-1 text-sm text-muted">
        选择模型服务商，填写 API key。配置保存在项目根目录的 .env.local，
        保存后需要重启开发服务器才会生效。
      </p>

      {current ? (
        <div
          className={`mt-6 flex items-center gap-2 rounded-md border border-line px-4 py-2.5 text-sm ${
            current.configured ? "text-pass" : "text-warn"
          }`}
        >
          {current.configured ? (
            <CheckCircle size={16} weight="fill" />
          ) : (
            <Lightning size={16} weight="fill" />
          )}
          {current.configured
            ? `当前已配置：${current.provider} · ${current.modelWorker ?? "(默认模型)"}`
            : "当前未配置模型凭据，造题功能不可用。"}
          {keyMasked ? (
            <span className="ml-auto font-mono text-xs text-subtle">
              key: {keyMasked}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[0.85fr_1.15fr]">
        {/* Provider picker */}
        <section>
          <h2 className="text-sm font-semibold text-ink">选择服务商</h2>
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
            {PRESETS.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => applyPreset(item.id)}
                  aria-pressed={presetId === item.id}
                  className={`flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors duration-300 ${
                    presetId === item.id ? "bg-inset" : "hover:bg-inset"
                  }`}
                >
                  <span
                    className={`text-sm font-medium ${
                      presetId === item.id ? "text-accent-text" : "text-ink"
                    }`}
                  >
                    {item.label}
                  </span>
                  <span className="text-xs text-subtle">{item.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Config form */}
        <section className="rounded-lg border border-line bg-surface p-6 shadow-card">
          {isOpencode ? (
            <>
              <div className="rounded-md border border-line bg-inset px-4 py-3">
                <p className="text-sm font-medium text-ink">本地 OpenCode</p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">
                  题目生成会调用本机安装的 OpenCode CLI（<code className="font-mono">opencode run</code>），
                  使用它自己已登录的 provider 与配额，因此这里不需要填 API Key。
                </p>
                <p className="mt-2 text-xs leading-relaxed text-warn">
                  注意：OpenCode 以<strong>只读</strong>方式运行在临时目录中，只负责「产出文本」；
                  写文件、编译、造数据与修复仍由本流水线完成。
                  每次调用它都会启动一个私有服务，约需 30–45 秒启动开销，明显慢于直连 API。
                </p>
              </div>

              <div className="mt-6 flex flex-col gap-2">
                <label htmlFor="opencodeCli" className="text-sm font-medium text-ink">
                  OpenCode CLI 路径（可选）
                </label>
                <input
                  id="opencodeCli"
                  value={opencodeCli}
                  onChange={(e) => setOpencodeCli(e.target.value)}
                  placeholder="留空 = 自动查找（%LOCALAPPDATA%\Programs\@opencodedesktop\resources\opencode-cli.exe）"
                  className="rounded-md border border-line-strong bg-raised px-3 py-2 font-mono text-xs text-ink placeholder:text-subtle focus-ring"
                />
                <p className="text-xs text-subtle">
                  如果 OpenCode 不在默认位置或 PATH 上，填 opencode-cli.exe 的完整路径。
                </p>
              </div>

              <div className="mt-6 flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="opencodeModelSelect" className="text-sm font-medium text-ink">
                    模型
                  </label>
                  <button
                    type="button"
                    onClick={loadOpencodeModels}
                    disabled={loadingModels}
                    className="rounded-md border border-line-strong px-2.5 py-1 text-xs font-medium text-ink transition-colors duration-300 hover:bg-inset disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingModels ? "读取中…" : "读取本机可用模型"}
                  </button>
                </div>
                <input
                  id="opencodeModelSelect"
                  value={modelArchitect}
                  onChange={(e) => {
                    setModelArchitect(e.target.value);
                    setModelWorker(e.target.value);
                  }}
                  list="opencode-model-list"
                  placeholder="opencode/ling-3.1-flash-free"
                  className="rounded-md border border-line-strong bg-raised px-3 py-2 font-mono text-sm text-ink placeholder:text-subtle focus-ring"
                />
                <datalist id="opencode-model-list">
                  {opencodeModels.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <p className="text-xs text-subtle">
                  {opencodeModels.length > 0
                    ? `本机可用 ${opencodeModels.length} 个模型，可从下拉中选。`
                    : "点右侧按钮从本机 OpenCode 读取可用模型（需要已在 OpenCode 中登录 provider）。"}
                </p>
                {opencodeModelsError ? (
                  <p role="alert" className="rounded-md border border-line bg-inset px-3 py-2 text-xs text-warn">
                    {opencodeModelsError}
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <>
          <div className="flex flex-col gap-2">
            <label htmlFor="baseUrl" className="text-sm font-medium text-ink">
              Base URL
            </label>
            <input
              id="baseUrl"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.deepseek.com/v1"
              className="rounded-md border border-line-strong bg-raised px-3 py-2 font-mono text-sm text-ink placeholder:text-subtle focus-ring"
            />
            <p className="text-xs text-subtle">
              OpenAI 兼容端点或 Anthropic 端点，以 /v1 结尾。
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <label htmlFor="apiKey" className="text-sm font-medium text-ink">
              API Key
            </label>
            <input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keyMasked ? `已保存（${keyMasked}），留空则不修改` : "sk-..."}
              autoComplete="off"
              className="rounded-md border border-line-strong bg-raised px-3 py-2 font-mono text-sm text-ink placeholder:text-subtle focus-ring"
            />
            <p className="text-xs text-subtle">
              只写入本地 .env.local，不会发送到任何第三方。
            </p>
          </div>
            </>
          )}

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="modelArchitect" className="text-sm font-medium text-ink">
                架构师模型
              </label>
              <input
                id="modelArchitect"
                value={modelArchitect}
                onChange={(e) => setModelArchitect(e.target.value)}
                placeholder="deepseek-reasoner"
                className="rounded-md border border-line-strong bg-raised px-3 py-2 font-mono text-sm text-ink placeholder:text-subtle focus-ring"
              />
              <p className="text-xs text-subtle">负责题目架构与最终审查，需要最强推理。</p>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="modelWorker" className="text-sm font-medium text-ink">
                Worker 模型
              </label>
              <input
                id="modelWorker"
                value={modelWorker}
                onChange={(e) => setModelWorker(e.target.value)}
                placeholder="deepseek-chat"
                className="rounded-md border border-line-strong bg-raised px-3 py-2 font-mono text-sm text-ink placeholder:text-subtle focus-ring"
              />
              <p className="text-xs text-subtle">三个并行子 agent 使用，便宜快速即可。</p>
            </div>
          </div>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="maxTokens" className="text-sm font-medium text-ink">
                单次输出上限（tokens）
              </label>
              <input
                id="maxTokens"
                value={maxOutputTokens}
                onChange={(e) => setMaxOutputTokens(e.target.value)}
                inputMode="numeric"
                className="rounded-md border border-line-strong bg-raised px-3 py-2 font-mono text-sm text-ink focus-ring"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="timeout" className="text-sm font-medium text-ink">
                请求超时（毫秒）
              </label>
              <input
                id="timeout"
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(e.target.value)}
                inputMode="numeric"
                className="rounded-md border border-line-strong bg-raised px-3 py-2 font-mono text-sm text-ink focus-ring"
              />
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <input
              id="runVerification"
              type="checkbox"
              checked={runVerification}
              onChange={(e) => setRunVerification(e.target.checked)}
              className="h-4 w-4 rounded border-line-strong accent-[var(--accent)]"
            />
            <label htmlFor="runVerification" className="text-sm text-ink">
              生成后自动本地验题（需要 PowerShell 7 与 g++）
            </label>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-on-accent transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "保存中…" : "保存配置"}
            </button>
            <button
              type="button"
              onClick={test}
              disabled={testing}
              className="inline-flex items-center gap-2 rounded-md border border-line-strong px-5 py-2.5 text-sm font-medium text-ink transition-colors duration-300 hover:bg-inset disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testing ? "测试中…" : "测试连接"}
            </button>
          </div>

          {message ? (
            <p
              role="status"
              className={`mt-4 flex items-start gap-2 rounded-md border border-line bg-inset px-3 py-2 text-sm ${
                messageKind === "ok" ? "text-pass" : "text-fail"
              }`}
            >
              {messageKind === "ok" ? (
                <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
              ) : (
                <XCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
              )}
              {message}
            </p>
          ) : null}
        </section>
      </div>

      {/* Local-model training panel */}
      <section className="mt-12 rounded-lg border border-line bg-sunken p-6">
        <h2 className="text-lg font-semibold leading-snug tracking-normal text-ink">
          本地模型训练
        </h2>
        <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-muted">
          每次验题通过的云端生成都会自动保存为训练样本（training/dataset/）。
          样本量足够后，可以在有 NVIDIA GPU 的机器上运行 LoRA 微调，
          把模型导入 Ollama，再用「自定义」预设接入本页，实现完全本地出题。
        </p>

        {training ? (
          <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
            {[
              ["题目数", `${training.files}`],
              ["样本总数", `${training.samples}`],
              ["已验证样本", `${training.verified}`],
            ].map(([label, value]) => (
              <div key={label} className="bg-surface px-5 py-4">
                <p className="text-xs text-subtle">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-ink">
                  {value}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {training ? (
          <p
            className={`mt-4 text-sm ${training.ready ? "text-pass" : "text-warn"}`}
          >
            {training.advice}
          </p>
        ) : null}

        <details className="mt-5 rounded-md border border-line bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-ink">
            训练步骤（需要 NVIDIA GPU + WSL2）
          </summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
            <li>
              在 WSL2 中安装依赖：
              <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-xs">
                pip install unsloth
              </code>
            </li>
            <li>
              训练：
              <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-xs">
                python training/finetune.py
              </code>
              （默认基座 Qwen2.5-Coder-14B，16GB 显存可用）
            </li>
            <li>
              导入 Ollama：
              <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-xs">
                python training/export_ollama.py
              </code>
            </li>
            <li>
              回到本页选择「自定义」，Base URL 填
              <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-xs">
                http://localhost:11434/v1
              </code>
              ，模型名填
              <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-xs">
                acm-problem-gen
              </code>
            </li>
          </ol>
        </details>
      </section>
    </div>
  );
}
