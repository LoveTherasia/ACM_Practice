import type { ProblemConfig } from "./schema";

/**
 * Validator-accepts-generator preflight.
 *
 * run-all-tests.ps1 feeds the generator's data to the validator during a full
 * verification, but the preflight historically never did. It checked that the
 * statement's samples match the generated data (checkDeclaredSamples) and that
 * the generator implements every declared type, yet never asked whether the
 * validator would ACCEPT what the generator emits. template-001 slipped through
 * exactly there: its generator printed the edge "4 1" (u > v) while its validator
 * requires u_i < v_i, and the statement declared the same "4 1", so every other
 * check passed and the mismatch only surfaced after a full verification run as a
 * validator `_fail` (exit 3).
 *
 * This runs the generator and pipes its output into the validator, inside the
 * sandbox. The FIRST rejected case is reported and the loop stops: the generator
 * and validator are shared by every case, so one rejection is structural. Cases
 * whose generator or validator cannot run are skipped - the compile preflight
 * reports those with better context.
 */

type GeneratorRunner = (
  type: string,
  seed: number,
) => Promise<{ code: number; stdout: string } | null>;

type ValidatorRunner = (
  input: string,
) => Promise<{ code: number; stderr: string; timedOut: boolean } | null>;

/** Cap the inlined generator output so one huge case cannot flood the report. */
const MAX_INPUT_PREVIEW = 1500;

function previewInput(text: string): string {
  const normalised = text.replace(/\r\n/g, "\n");
  const clipped =
    normalised.length > MAX_INPUT_PREVIEW
      ? `${normalised.slice(0, MAX_INPUT_PREVIEW)}\n…（已截断）`
      : normalised;
  return clipped.replace(/\s+$/, "");
}

/** The validator's own words, with absolute workspace prefixes stripped. */
function validatorError(stderr: string, code: number): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.replace(/^[A-Za-z]:\\[^\s:]+\\/, "").trim())
    .filter((line) => line !== "");
  return lines.slice(-8).join("\n") || `（validator 退出码 ${code}，但没有输出）`;
}

export async function checkValidatorAcceptsGenerator(
  problemId: string,
  config: ProblemConfig,
  runGenerator: GeneratorRunner,
  runValidator: ValidatorRunner,
): Promise<string[]> {
  void problemId;
  const cases = config.generator.cases;
  if (cases.length === 0) {
    return [];
  }

  for (const item of cases) {
    const generated = await runGenerator(item.type, item.seed);
    if (!generated) {
      // The generator compiled (otherwise there is no runner) yet failed to
      // produce data for a declared type - almost always a type it does not
      // implement. Verification will fail on this case too.
      return [
        [
          "### generator 无法为声明的 case 产出数据",
          "```",
          `case：${item.name}（type=${item.type}, seed=${item.seed}）`,
          "```",
          "generator 能编译，但用这个 type 运行时没有正常退出。",
          "最常见的原因是它不在 generator 的分支里，落到了报错或兜底路径。",
          "请核对 `generator.cpp` 的 type 分发与 config.json 的 case 清单是否一致。",
        ].join("\n"),
      ];
    }

    const validated = await runValidator(generated.stdout);
    if (!validated) {
      // Could not run the validator at all; the compile preflight reports that.
      continue;
    }
    if (validated.code !== 0) {
      return [
        [
          "### validator 拒绝了 generator 产出的数据",
          "```",
          `case：${item.name}（type=${item.type}, seed=${item.seed}）`,
          `validator 退出码：${validated.code}${validated.timedOut ? "（超时）" : ""}`,
          "```",
          "**generator 输出**（前若干行）：",
          "```",
          previewInput(generated.stdout),
          "```",
          "**validator 报错**：",
          "```",
          validatorError(validated.stderr, validated.code),
          "```",
          "完整验题跑到这个 case 时一定会失败，本检查只是把它提前到预检。",
          "常见根因是 generator 与 validator 对输入格式的理解不一致：",
          "行数不同、每行字段数不同、端点顺序（例如题目要求 `u_i < v_i`）、",
          "重边/自环约定不同，或多/少输出了结尾。",
          "请以题面声明的输入格式契约为准，改正 generator 与 validator 中的一方或两方，",
          "使 generator 的每一类输出都能通过 validator。",
        ].join("\n"),
      ];
    }
  }

  return [];
}
