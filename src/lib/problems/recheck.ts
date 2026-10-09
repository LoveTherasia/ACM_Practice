import { z } from "zod";

import { complete, LlmError } from "@/lib/llm/provider";
import { readProblem, readWorkspaceFile } from "@/lib/problems/store";
import { auditCoverage, summarizeCoverage } from "@/lib/problems/coverage";

/**
 * AI re-check of a generated problem.
 *
 * The pipeline verifies that the problem *runs*: it compiles, generates data,
 * and the reference solutions pass. That says nothing about whether the problem
 * is *correct*. A problem can pass every mechanical check and still be wrong -
 * a checker that accepts any answer, a statement whose sample contradicts its
 * own output format, a tutorial describing a different algorithm than the code
 * implements, data that never exercises the stated constraints.
 *
 * This is the read-only second opinion for exactly those questions. It is
 * report-only by design: it never writes to the workspace. A wrong-solution
 * repair is mechanical (the compiler says what is broken), but "this checker
 * only compares the first token" is a judgement call, and silently editing a
 * problem on the strength of one model opinion is how a working problem gets
 * broken. The report goes to the user, who decides.
 */

export const recheckSeveritySchema = z.enum(["high", "medium", "low"]);

export const recheckFindingSchema = z.object({
  /** Which artefact the problem is in: 题面 / checker / 标程 / 数据 / 题解 … */
  area: z.string().min(1),
  severity: recheckSeveritySchema,
  /** What is wrong, concretely. */
  issue: z.string().min(1),
  /** Why it matters, and how to fix it. */
  suggestion: z.string().default(""),
});

export const recheckReportSchema = z.object({
  /** Overall verdict on whether the problem is usable as generated. */
  verdict: z.enum(["ok", "needs-work", "broken"]),
  /** One paragraph summary. */
  summary: z.string().default(""),
  findings: z.array(recheckFindingSchema).default([]),
});

export type RecheckFinding = z.infer<typeof recheckFindingSchema>;
export type RecheckReport = z.infer<typeof recheckReportSchema>;

/** Cap each document so a long statement cannot blow the context budget. */
function clip(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n\n...（过长，已截断）`;
}

export const RECHECK_SYSTEM = `
你是 ICPC 出题评审。你会拿到一道已生成题目的全部产物，任务是**找出真实的错误**，
而不是夸奖它。本地验题脚本已经验证过它能编译、能造数据、标程能通过，
所以**不要报告"能不能跑"**——请集中找下面这些语义问题：

1. **checker 是否真的在判题**
   - 是否只比较了输出的第一个数 / 只比较部分字段？
   - 多解题是否只做逐字比对（会误判合法解为 WA）？
   - 浮点题是否真的实现了题面声明的误差标准？
   - 是否读了 ouf 与 ans 到 EOF，多余输出有没有被判掉？
2. **validator 与题面是否一致**
   - 题面声明的每个范围、结构性质（树/连通/互异/排列），validator 是否都检查了？
   - validator 的界与题面的界是否**逐字一致**（不一致会让边界数据整批失败）？
3. **generator 与题面是否一致**
   - 生成的数据是否真的落在题面声明的范围内？
   - 是否覆盖了题面的边界（下界、上界、极端结构）？
   - 是否存在名不副实的测试点（叫 boundary-max 却不是上界规模）？
4. **标程是否真的正确**
   - 两份标程（solution.cpp / solution2.cpp）思路是否独立？还是换了个变量名的复制？
   - 有没有明显漏洞：未初始化、溢出、边界少算、多测未清空？
   - 复杂度是否符合题面/题解声明？
   - 概率期望、取模、浮点题的数值处理是否稳妥？
5. **题面与题解质量**
   - 题面是否自包含：关键定义、数据范围、输出约定是否都说清了？
   - 样例是否与题面声明的输入输出格式**一致**（行数、字段数）？
   - 题解描述的算法是否与标程实际实现一致？复杂度是否一致？
   - 题解是否有凭空出现、未解释的结论？
6. **数据强度**
   - 是否存在明显的空洞：某个输入量的边界没有对应测试点？
   - 随机数据是否喧宾夺主而边界数据缺失？

## 输出格式

只输出一个 JSON 对象，不要写任何解释文字，不要用 markdown 代码块包裹：

\`\`\`json
{
  "verdict": "ok | needs-work | broken",
  "summary": "一段话总结这道题的可用性与主要风险",
  "findings": [
    {
      "area": "checker",
      "severity": "high | medium | low",
      "issue": "具体问题，要能定位到文件与行为",
      "suggestion": "怎么修，或为什么需要人工确认"
    }
  ]
}
\`\`\`

判定标准：
- \`broken\`：存在会导致错误判题的问题（题目当前不可用）。
- \`needs-work\`：能跑，但有会影响选手体验或数据强度的问题。
- \`ok\`：通读后没发现实质问题。

**没有发现问题就返回空的 findings 数组并给 \`ok\`，不要为了凑数编造问题。**
宁可少报也不要报不存在的问题——虚假告警会让人不再相信这个检查。
只报告你能从给定内容中**确证**的问题；如果某处需要更多信息才能判断，不要猜。
`.trim();

/**
 * Review a workspace and return the findings.
 *
 * Read-only: nothing in here writes to the workspace.
 */
export async function recheckProblem(problemId: string): Promise<RecheckReport> {
  const detail = await readProblem(problemId);
  if (!detail) {
    throw new Error(`题目不存在: ${problemId}`);
  }
  const { config, meta } = detail;

  /** Read a workspace file, tolerating a missing one. */
  const read = async (relative: string): Promise<string> => {
    try {
      return (await readWorkspaceFile(problemId, relative)) ?? "";
    } catch {
      return "";
    }
  };

  const [statement, tutorial, validator, generator, checker] = await Promise.all([
    read(config.statement),
    read(config.tutorial),
    read(config.validator),
    read(config.generator.path),
    read(config.checker ?? ""),
  ]);

  // Every reference solution, plus the wrong ones: a "wrong" solution that is
  // actually correct is a signal the data is too weak to separate them.
  const solutionTexts = await Promise.all(
    config.solutions.map(async (entry) => ({
      name: entry.name,
      role: entry.role,
      path: entry.path,
      content: await read(entry.path),
    })),
  );
  const wrongTexts = await Promise.all(
    config.wrongSolutions.map(async (entry) => ({
      name: entry.name,
      path: entry.path,
      content: await read(entry.path),
    })),
  );

  const coverage = auditCoverage(config);

  const casePlan = config.generator.cases
    .map(
      (c) =>
        `- ${c.name}: type=${c.type}, seed=${c.seed}, group=${c.group}` +
        (c.coverage ? `（意图：${c.coverage}）` : ""),
    )
    .join("\n");

  const sections: string[] = [
    "## 题目元信息",
    "",
    `- slug: ${config.slug}`,
    `- 标题: ${config.title}`,
    `- 难度: ${meta.difficulty}`,
    `- 交互题: ${config.interactive ? "是" : "否"}`,
    `- 时间/内存: ${config.timeLimitMs} ms / ${config.memoryLimitMb} MB`,
    `- 预期做法: ${meta.expectedApproach || "(未填写)"}`,
    `- 预期复杂度: ${meta.complexity || "(未填写)"}`,
    `- 输入格式契约: ${meta.inputFormat || "(未填写)"}`,
    `- 输出格式契约: ${meta.outputFormat || "(未填写)"}`,
    "",
    "## 数据覆盖审计（由本地工具统计）",
    "",
    summarizeCoverage(coverage),
    ...coverage.gaps.map((gap) => `- 覆盖提示：${gap.message}`),
    "",
    "## 测试点清单",
    "",
    casePlan || "(空)",
    "",
    "## 题面 docs/statement.md",
    "",
    "```markdown",
    clip(statement, 14000),
    "```",
    "",
    "## 题解 docs/tutorial.md",
    "",
    "```markdown",
    clip(tutorial, 14000),
    "```",
    "",
    "## config.json（节选：判定与解法清单）",
    "",
    "```json",
    clip(
      JSON.stringify(
        {
          validator: config.validator,
          generator: config.generator.path,
          checker: config.checker,
          interactor: config.interactor,
          solutions: config.solutions,
          wrongSolutions: config.wrongSolutions,
        },
        null,
        2,
      ),
      3000,
    ),
    "```",
    "",
    "## src/validator/validator.cpp",
    "",
    "```cpp",
    clip(validator, 9000),
    "```",
    "",
    "## src/generator/generator.cpp",
    "",
    "```cpp",
    clip(generator, 12000),
    "```",
  ];

  if (checker.trim()) {
    sections.push(
      "",
      config.interactive
        ? "## src/checker/interactor.cpp"
        : "## src/checker/checker.cpp",
      "",
      "```cpp",
      clip(checker, 9000),
      "```",
    );
  }

  for (const solution of solutionTexts) {
    sections.push(
      "",
      `## ${solution.path}（${solution.name}, role=${solution.role}）`,
      "",
      "```cpp",
      clip(solution.content, 9000),
      "```",
    );
  }

  for (const wrong of wrongTexts) {
    sections.push(
      "",
      `## ${wrong.path}（错解 ${wrong.name}，observe 模式）`,
      "",
      "```cpp",
      clip(wrong.content, 5000),
      "```",
    );
  }

  sections.push(
    "",
    "## 任务",
    "",
    "通读以上全部内容，按系统提示的六类问题逐一检查，输出 JSON 报告。",
    "重点确认：checker 真的在判题、validator 与题面逐字一致、",
    "generator 覆盖了题面边界、两份标程思路独立且正确、题解与代码一致。",
  );

  const reply = await complete(
    [
      { role: "system", content: RECHECK_SYSTEM },
      { role: "user", content: sections.join("\n") },
    ],
    { maxTokens: 8000 },
  );

  return parseRecheckReply(reply);
}

/**
 * Parse the model's JSON report.
 *
 * The model reliably wraps JSON in a markdown fence or prefixes it with a
 * sentence no matter how firmly the prompt forbids it, so extract the outermost
 * object rather than trusting the raw reply.
 */
export function parseRecheckReply(reply: string): RecheckReport {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new LlmError(
      `复核结果不是 JSON（回复开头：${reply.slice(0, 200).replace(/\s+/g, " ")}）`,
    );
  }
  const slice = reply.slice(start, end + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch (error) {
    throw new LlmError(
      `复核结果的 JSON 无法解析：${(error as Error).message}；` +
        `片段开头：${slice.slice(0, 200).replace(/\s+/g, " ")}`,
    );
  }

  const result = recheckReportSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(根)"}: ${i.message}`)
      .slice(0, 5)
      .join("; ");
    throw new LlmError(`复核结果结构不符合要求（${issues}）。`);
  }

  // Highest severity first: the reader wants the blocking problems on top.
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const findings = [...result.data.findings].sort(
    (a, b) => rank[a.severity] - rank[b.severity],
  );

  return { ...result.data, findings };
}
