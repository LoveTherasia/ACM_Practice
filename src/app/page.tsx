import { ArrowDown } from "@phosphor-icons/react/ssr";
import Link from "next/link";

import { SiteNav } from "@/components/marketing/site-nav";
import { Reveal } from "@/components/marketing/reveal";
import { PARALLEL_ROLES, STAGES } from "@/lib/pipeline/stages";

/**
 * The marketing landing page.
 *
 * taste-skill design read: developer-tool landing for competitive-programming
 * problem setters, Linear-style minimalist language, Tailwind utilities + Geist,
 * restrained motion. Dials: VARIANCE 6 / MOTION 5 / DENSITY 4.
 *
 * Layout: asymmetric split hero (Section 4.3 anti-center bias), one accent hue
 * (Section 4.2 colour lock, hue 258 electric blue), soft radius scale
 * (Section 4.4 shape lock), scroll reveal as an isolated client leaf
 * (Section 3.A interactivity isolation).
 *
 * Backgrounds are atmospheric rather than flat: see the field-* classes and the
 * grain film in globals.css section 5.
 */

const HERO_STATS = [
  { value: "5", label: "个流水线阶段" },
  { value: "2", label: "个并行子 agent" },
  { value: "30+", label: "个测试点起，每题" },
  { value: "2", label: "份思路独立的正解" },
];

const ARTIFACTS = [
  {
    title: "题面与题解",
    description:
      "正式完整的 statement 与 tutorial，数据范围逐字段覆盖，样例有强度且不泄露核心结论。",
    files: ["docs/statement.md", "docs/tutorial.md"],
  },
  {
    title: "标程与参考解",
    description:
      "两份思路独立的正确实现用于交叉验证，适用时附带可运行的 Python 参考解。",
    files: ["src/solution.cpp", "src/solution2.cpp"],
  },
  {
    title: "全面数据与对拍",
    description:
      "按覆盖矩阵规划测试点：范围边界、极端结构与参数取值的各种组合都要有；小数据用两份独立标程对拍，大数据压时限与常数。",
    files: ["src/generator/generator.cpp", "src/validator/validator.cpp"],
  },
  {
    title: "judge 全家桶",
    description:
      "testlib 驱动的 validator、checker / interactor，严格校验格式、范围与 EOF。",
    files: ["src/checker/checker.cpp", "src/validator/validator.cpp"],
  },
];

export default function LandingPage() {
  return (
    <div className="min-viewport">
      {/* Section 6.E: grain lives on one fixed, inert layer. */}
      <div className="grain" aria-hidden="true" />

      <SiteNav />

      {/* ---------------- Hero: asymmetric split, not centered ---------------- */}
      <section className="field field-hero relative overflow-hidden">
        <div className="relative z-10 mx-auto grid max-w-[1400px] gap-12 px-4 pb-24 pt-16 sm:px-6 md:pt-24 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:px-8">
          <div className="flex flex-col justify-center">
            <Reveal>
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-raised/70 px-3 py-1 text-xs font-medium text-muted backdrop-blur-sm">
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 rounded-full bg-accent"
                />
                AI 自主出题流水线
              </p>
              <h1 className="max-w-[16ch] text-4xl font-semibold leading-[1.2] tracking-normal text-ink md:text-6xl">
                一个 idea，
                <br />
                一套完整题目
              </h1>
              <p className="mt-6 max-w-[58ch] text-base leading-relaxed text-muted">
                给出题目想考什么机制，流水线自动产出题面、题解、标程、错解、
                generator、validator 与 checker，
                并在本地编译、造数据、跑标程、卡错解，直到全部通过。
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href="/console/generate"
                  className="inline-flex items-center rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-on-accent shadow-card transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-[1px] active:scale-[0.98]"
                >
                  开始造题
                </Link>
                {/* Section 4.5 forbids two labels for one intent, so the hero's
                    secondary action explores the page rather than re-offering the
                    console, which the nav already labels 打开控制台. */}
                <Link
                  href="#pipeline"
                  className="group inline-flex items-center gap-1.5 rounded-md border border-line-strong px-5 py-2.5 text-sm font-medium text-ink transition-colors duration-300 hover:bg-inset"
                >
                  看工作原理
                  <ArrowDown
                    size={14}
                    weight="bold"
                    className="transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-y-0.5"
                  />
                </Link>
              </div>
            </Reveal>

            <Reveal delay={0.1}>
              <dl className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line backdrop-blur-sm sm:grid-cols-4">
                {HERO_STATS.map((stat) => (
                  <div key={stat.label} className="bg-surface/80 px-4 py-4">
                    <dt className="font-mono text-2xl font-semibold tracking-tight text-ink tabular-nums">
                      {stat.value}
                    </dt>
                    <dd className="mt-1 text-xs text-subtle">{stat.label}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>

          {/* Terminal-style visual: the pipeline as a live transcript */}
          <Reveal delay={0.15} className="lg:pt-8">
            <div className="panel overflow-hidden rounded-lg border border-line shadow-panel">
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-line-strong" />
                <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-line-strong" />
                <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-line-strong" />
                <span className="ml-2 font-mono text-xs text-subtle">
                  run-all-tests.ps1
                </span>
              </div>
              <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-6 text-muted">
                <code>
                  <span className="text-accent-text">&gt; architect</span>
                  {"    定架构与题面        "}
                  <span className="text-pass">done</span>
                  {"\n"}
                  <span className="text-accent-text">&gt; judge-validator</span>
                  {"  checker/validator  "}
                  <span className="text-pass">done</span>
                  {"\n"}
                  <span className="text-accent-text">&gt; solutions-tutorial</span>
                  {" 标程与题解      "}
                  <span className="text-pass">done</span>
                  {"\n"}
                  <span className="text-accent-text">&gt; integrator</span>
                  {"   整体一致性审查       "}
                  <span className="text-pass">done</span>
                  {"\n"}
                  <span className="text-accent-text">&gt; verifier</span>
                  {"     本地验题            "}
                  <span className="text-accent">running</span>
                  {"\n\n"}
                  <span className="text-subtle">[compile]</span>
                  {"  solution.cpp ... "}
                  <span className="text-pass">ok</span>
                  {"\n"}
                  <span className="text-subtle">[compile]</span>
                  {"  solution2.cpp ... "}
                  <span className="text-pass">ok</span>
                  {"\n"}
                  <span className="text-subtle">[generate]</span>
                  {" 32 cases ... "}
                  <span className="text-pass">ok</span>
                  {"\n"}
                  <span className="text-subtle">[validate]</span>
                  {"  32 cases ... "}
                  <span className="text-pass">ok</span>
                  {"\n"}
                  <span className="text-subtle">[check-reference]</span>
                  {"  solution2 ... "}
                  <span className="text-pass">ok</span>
                  {"\n"}
                  <span className="text-subtle">[verify]</span>
                  {"   main "}
                  <span className="text-pass">passed 32 cases</span>
                  {"\n"}
                  <span className="text-pass">[success]</span>
                  {"  shortest-path-tree passed 32 cases"}
                </code>
              </pre>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------- Pipeline ---------------- */}
      <section id="pipeline" className="field field-pipeline border-t border-line">
        <div className="mx-auto max-w-[1400px] px-4 py-24 sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="max-w-[20ch] text-3xl font-semibold leading-tight tracking-normal text-ink md:text-4xl">
              主 agent 定架构，两个子 agent 真正并行
            </h2>
            <p className="mt-5 max-w-[62ch] text-base leading-relaxed text-muted">
              架构定下来之后，judge/数据与标程/题解两条线同时开跑。
              每个角色只写分配给它的文件，谁也不会覆盖谁；
              全部落地后再由整合阶段逐项核对，最后交给本地验题脚本定生死。
            </p>
          </Reveal>

          <ol className="mt-14 grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2 lg:grid-cols-3">
            {STAGES.map((stage, index) => {
              const parallel = PARALLEL_ROLES.includes(stage.role);
              return (
                <li key={stage.role} className="panel p-6">
                  <div className="flex items-baseline justify-between gap-3">
                    {/* The role identifier, not an ordinal: Section 9.F bans
                        section-number eyebrows like "01 / INDEX". */}
                    <span className="font-mono text-xs text-accent-text">
                      {stage.roleKey}
                    </span>
                    {parallel ? (
                      <span className="font-mono text-[11px] text-subtle">
                        并行
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-ink">
                    {stage.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    {stage.summary}
                  </p>
                  <Reveal delay={0.04 * index}>
                    <p className="mt-4 font-mono text-[11px] leading-5 text-subtle">
                      {stage.targets.join("  ")}
                    </p>
                  </Reveal>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* ---------------- Artifacts ---------------- */}
      <section id="artifacts" className="field field-artifacts border-t border-line">
        <div className="mx-auto max-w-[1400px] px-4 py-24 sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="max-w-[20ch] text-3xl font-semibold leading-tight tracking-normal text-ink md:text-4xl">
              一次生成什么
            </h2>
            <p className="mt-5 max-w-[62ch] text-base leading-relaxed text-muted">
              每道题是一个由 config.json 驱动的完整工作区。
              路径、case 规划、参考解与错解清单都写在同一份配置里，
              验题脚本照着它跑，不允许 TODO、占位文本或空实现。
            </p>
          </Reveal>

          <div className="mt-14 grid gap-5 md:grid-cols-2">
            {ARTIFACTS.map((artifact, index) => (
              <Reveal key={artifact.title} delay={index * 0.05}>
                <article className="panel h-full rounded-lg border border-line p-6 shadow-card">
                  <h3 className="text-base font-semibold text-ink">
                    {artifact.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    {artifact.description}
                  </p>
                  <ul className="mt-5 space-y-1.5">
                    {artifact.files.map((file) => (
                      <li
                        key={file}
                        className="flex items-center gap-2 font-mono text-[11.5px] text-subtle"
                      >
                        <span
                          aria-hidden
                          className="h-1 w-1 shrink-0 rounded-full bg-line-strong"
                        />
                        {file}
                      </li>
                    ))}
                  </ul>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Verification ---------------- */}
      <section
        id="verification"
        className="field field-verification border-t border-line"
      >
        <div className="mx-auto grid max-w-[1400px] gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:px-8">
          <Reveal>
            <h2 className="max-w-[18ch] text-3xl font-semibold leading-tight tracking-normal text-ink md:text-4xl">
              验题不是可选项
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted">
              生成结束后自动调用本地验题脚本：编译全部源文件、
              按 type + seed 复现每个测试点、跑标程核对答案、
              确认每个错解都被定向数据卡掉。
              任何一步失败，这道题就不会被标记为通过。
            </p>
            <p className="mt-4 text-base leading-relaxed text-muted">
              完整日志保存在本地，随时可以在控制台重新验题。
            </p>
          </Reveal>

          <Reveal delay={0.1}>
            <ul className="panel-sunken divide-y divide-line rounded-lg border border-line">
              {[
                ["编译", "g++ gnu++20，全部源文件零警告通过"],
                ["造数据", "generator 按 case type + seed 完全复现"],
                ["判答案", "checker / interactor 与题面逐项对齐"],
                ["卡错解", "每个错解都被至少一个定向数据卡掉"],
              ].map(([term, desc]) => (
                <li key={term} className="flex gap-5 px-6 py-5">
                  <span className="w-14 shrink-0 font-mono text-xs leading-6 text-accent-text">
                    {term}
                  </span>
                  <span className="text-sm leading-6 text-muted">{desc}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ---------------- Footer CTA ---------------- */}
      <footer className="field field-footer border-t border-line">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-8 px-4 py-16 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div>
            <p className="text-lg font-semibold tracking-normal text-ink">
              准备好出一道题了吗？
            </p>
            <p className="mt-1 text-sm text-muted">
              从一个 idea 到通过本地验题，全程自动。
            </p>
          </div>
          <Link
            href="/console/generate"
            className="inline-flex shrink-0 items-center rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-on-accent shadow-card transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-[1px] active:scale-[0.98]"
          >
            开始造题
          </Link>
        </div>
      </footer>
    </div>
  );
}