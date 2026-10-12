import { promises as fs } from "node:fs";
import path from "node:path";

import { skillsDir } from "@/lib/paths";

/**
 * The author's ACM code style, applied to every C++ artefact we generate.
 *
 * The style lives in the vendored skill `skills/wsh代码风格skill/acm-code-style`
 * (a 146-line spec measured from ~1160 real contest solutions, plus a mandatory
 * boilerplate file). Rather than paraphrase it - which is how a spec drifts -
 * this module injects the rules that actually change what a checker or a
 * verifier sees, and points the model at the skill for the rest.
 *
 * Two of the rules interact with this pipeline and are worth stating explicitly:
 *
 *  - The style sets `#define int long long`, so `main` must be `signed main()`
 *    and every array is a 64-bit global sized by `N=1e6+10`. That is ~8 MB per
 *    int array, which is why the boilerplate declares only two.
 *  - The style forbids `endl` in favour of `"\n"`. This is not cosmetic here:
 *    the verifier drops a solution's stdout into a `.out` file and the checker
 *    reads it to EOF, so line endings matter. It also means the CRLF
 *    normalisation in run-all-tests.ps1 is doing real work.
 */

/** Where the skill lives, relative to the skills root. */
const STYLE_SKILL_DIR = path.join(skillsDir, "wsh代码风格skill", "acm-code-style");

/**
 * The skill directory, or null when the skill is not vendored.
 *
 * Returning the directory rather than the spec's path keeps the caller from
 * needing `path.dirname` just to build the block below.
 */
export async function styleSkillDir(): Promise<string | null> {
  try {
    await fs.access(path.join(STYLE_SKILL_DIR, "SKILL.md"));
    return STYLE_SKILL_DIR;
  } catch {
    return null;
  }
}

/** Absolute path to the spec file, or null when the skill is absent. */
export async function styleSkillPath(): Promise<string | null> {
  const dir = await styleSkillDir();
  return dir ? path.join(dir, "SKILL.md") : null;
}

/** Absolute path to the boilerplate the solutions must start from. */
export async function styleBoilerplatePath(): Promise<string | null> {
  const boilerplate = path.join(STYLE_SKILL_DIR, "references", "boilerplate.cpp");
  try {
    await fs.access(boilerplate);
    return boilerplate;
  } catch {
    return null;
  }
}

/**
 * Whether the style skill is present at all.
 *
 * When it is missing the prompt falls back to plain C++, so the pipeline still
 * works in a checkout that does not vendor the skill.
 */
export async function styleSkillAvailable(): Promise<boolean> {
  return (await styleSkillPath()) !== null;
}

/**
 * The style block appended to the solutions-tutorial prompt.
 *
 * Kept as instructions rather than a hard-coded template because the boilerplate
 * has a 41-line ASCII header that must be reproduced byte-for-byte; pasting it
 * through a prompt is precisely the thing the skill warns destroys the pattern,
 * so the model is told to copy the file instead.
 */
export function codeStylePromptBlock(skillDir: string): string {
  return `
## 代码风格（强制，适用于你写的每一个 .cpp）

本题库使用固定的个人 ACM 代码风格。**所有标程与错解都必须按它书写**，
不要用你自己习惯的写法（例如 \`#include <bits/stdc++.h>\` 带空格、
\`int main()\`、\`endl\`、lambda、驼峰命名）。

规范的完整定义在这里，写之前请先读：

- 规范：\`${path.join(skillDir, "SKILL.md")}\`
- 模板（**逐字复制，不要凭记忆敲**）：\`${path.join(skillDir, "references", "boilerplate.cpp")}\`
- 按题类路由的骨架：\`${path.join(skillDir, "references", "topics")}\` 下对应的 .md
- 由本技能产出的完整范例：\`${path.join(skillDir, "references", "examples", "cf1037a.cpp")}\`

### 必须遵守的硬性约定（按当前 2026 风格）

- 从 \`references/boilerplate.cpp\` **逐字复制**头部、头文件、辅助函数与 \`main\`，
  只替换空的 \`solve()\` 函数体和被占位的全局变量。
  **不要手敲那 41 行 ASCII 艺术头**——手工复制会破坏图案。
- \`#include<bits/stdc++.h>\`（\`#include\` 后**无空格**）。
- \`#define int long long\` 与 \`#define ull unsigned long long\` 都要有；
  \`#define lowbit(x) (x&(-x))\` **必须带括号**。
- 因为 \`int\` 是 64 位，入口必须写 **\`signed main()\`**，绝不写 \`int main()\`。
- 入口函数是 **\`void solve()\`**，题目逻辑写在里面；\`main\` 里只有 I/O 设置与
  \`int t=1;\` + \`cin>>t;\`（单测则写成 \`//cin>>t;\`，但保留 \`int t=1;\`）
  + \`while(t--) { solve(); }\`。
- **大括号用 K&R**（控制流的 \`{\` 同行）：\`for(int i=1;i<=n;i++) {\`、\`while(t--) {\`。
  2025 年那种另起一行的写法已过时，不要混用。
- 数组是**按 \`N\` 定大小的全局数组**（\`int a[N];\`），不要用局部大数组，
  也不要用 \`vector\` 替代普通数组。
- 数组**从下标 1 开始**：\`for(int i=1;i<=n;i++) cin>>a[i];\`
- 输出一律用 \`"\\n"\`，**绝不用 \`endl\`**（唯一例外是交互题的 \`fflush(stdout);\`）。
- 流运算符两侧**不留空格**：\`cin>>n;\`、\`cout<<res<<"\\n";\`
- 4 空格缩进。
- 无穷大用 \`MOD * MOD\`；**不要引入** \`0x3f\`、lambda、\`bool cmp\`、
  \`char s[]\`、\`to_string\`/\`stoi\`、\`__builtin_*\`。
- 命名一律小写 \`snake_case\`（\`push_up\`、\`query_sum\`）：\`res\` 累加答案、
  \`cnt\` 计数、\`fa[]\`/\`sz[]\` 并查集、\`e[]\`/\`ne[]\`/\`h[]\` 链式前向星。
- \`void\` 提前返回写 \`return ;\`（分号前留一个空格）。
- 排序写 \`sort(a+1,a+n+1)\`；降序用 \`greater<int>()\`；自定义顺序给 struct 写
  \`operator <\`。
- **不要新增解释性注释**。调试输出注释掉而不是删除（\`//cout<<i<<"\\n";\`）——
  这是该风格的既有习惯，保留即可。
- 源文件保持**无 BOM**。

**注意**：风格规范里 \`main\` 默认是 \`cin>>t;\`（多测）。本题若不是多测，
请按规范把它改成 \`//cin>>t;\`，并保持 \`int t=1;\`。
`.trim();
}
