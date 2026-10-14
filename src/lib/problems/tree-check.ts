import { promises as fs } from "node:fs";

import { problemPath } from "../paths";
import type { ProblemConfig } from "./schema";

/**
 * Tree-data validation for problems whose input is a tree.
 *
 * string-003 shipped three generator branches that produced CYCLES in what
 * the statement guarantees is a tree (a chain plus a hanging branch that
 * re-attached an already-connected node). The validator only checked the
 * edge count and value ranges, so the malformed data passed validation and
 * the defect surfaced much later as the two reference solutions disagreeing
 * on cases whose semantics were undefined. By then the failure said nothing
 * about the actual cause.
 *
 * This check runs BEFORE verification: when the problem is a tree problem,
 * every generator case type is executed once (inside the sandbox) and its
 * output is checked with a union-find - n-1 edges, acyclic, connected. A
 * violation is reported with the case type and the specific broken edge, so
 * the repair round can fix the generator branch directly.
 *
 * How "this problem is a tree problem" is decided, in priority order:
 *
 * 1. TAGS (primary, reliable): the architect is prompted to tag tree
 *    problems with the 树 tag, and graph problems carry graph-ish tags
 *    (图论/最短路/…). A graph-category problem whose tags contain 树 is a
 *    tree problem by declaration. This is a structured signal the model
 *    produced deliberately, not prose we guessed at.
 *
 * 2. STATEMENT TEXT (fallback, conservative): when the tags carry no tree
 *    information at all, an explicit guarantee in the statement sections
 *    (构成一棵树 / 是一棵树 / 给定一棵…的树 / 保证是树) still triggers the
 *    check. This catches problems whose tags forgot the 树 tag but whose
 *    statement is unambiguous.
 *
 * A statement that merely mentions trees in the tutorial, or uses a tree
 * algorithm without the input being one, does not trigger either path - a
 * false alarm here would train people to ignore the check.
 */

/** Tags that mark a problem as graph-shaped (the input is a graph of some kind). */
const GRAPH_TAGS = /^(图论|图|树|最短路|生成树|网络流|二分图|连通|拓扑|匹配|LCA|最近公共祖先|树上差分|欧拉|树形DP|树链剖分|线段树|树状数组|并查集|dfs|bfs|DFS|BFS)$/i;

/** Whether a tag list marks the input as a graph we can tree-check. */
function tagsDescribeGraph(tags: string[]): boolean {
  return tags.some((tag) => GRAPH_TAGS.test(tag.trim()));
}

/** Whether any tag explicitly declares the input is a tree. */
export function tagsDeclareTree(tags: string[]): boolean {
  return tags.some((tag) => /树/.test(tag));
}

/** Whether the statement explicitly guarantees that the input is a tree. */
export function statementGuaranteesTree(statement: string): boolean {
  // Only the 题目描述 and 数据范围 sections count: a tutorial that says
  // "树上的距离" while the input is a general graph must not trigger this.
  const sections = statement.split(/\n#{2,3}\s*/);
  const relevant = sections.filter((section) =>
    /^(题目描述|数据范围|输入格式)/.test(section),
  );
  const scope = relevant.length > 0 ? relevant.join("\n") : statement;
  return /(?:构成|是|保证[为是]?|给出[了]?|给定)\s*(?:一[棵颗]|一[棵颗][^。；;\n]{0,12}的)?树/.test(
    scope,
  ) || /保证[^。；;\n]{0,10}树/.test(scope);
}

/**
 * Decide whether this problem's input is a tree, from tags and statement.
 *
 * Tags win when they speak: a graph-tagged problem with a 树 tag is a tree
 * problem even if the statement prose is ambiguous, and a graph-tagged
 * problem WITHOUT any 树 tag is trusted to not be a tree problem (the
 * architect was asked to tag trees). The statement text is only consulted
 * when the tags carry no tree information at all.
 */
export function isTreeProblem(
  tags: string[],
  statement: string,
): { tree: boolean; reason: "tags" | "statement" | "none" } {
  const graphShaped = tagsDescribeGraph(tags);
  const declaresTree = tagsDeclareTree(tags);
  if (graphShaped) {
    // The tags describe a graph problem; the presence or absence of a 树
    // tag is the architect's deliberate declaration.
    return { tree: declaresTree, reason: "tags" };
  }
  if (declaresTree) {
    // A tree tag on a non-graph-tagged problem (e.g. tags are just ["树"]).
    return { tree: true, reason: "tags" };
  }
  // Tags say nothing about graphs or trees: fall back to the statement.
  return { tree: statementGuaranteesTree(statement), reason: "statement" };
}

/** Parse "n" and the edge list out of a generator's output. */
function parseTreeInput(output: string): {
  n: number;
  edges: [number, number][];
  header: string;
} | null {
  const lines = output.trim().split(/\r?\n/);
  if (lines.length === 0) {
    return null;
  }
  const header = lines[0] ?? "";
  const headerNums = header.trim().split(/\s+/).map(Number);
  const n = headerNums[0];
  if (!Number.isInteger(n) || n === undefined || n < 1) {
    return null;
  }
  const edges: [number, number][] = [];
  for (const line of lines.slice(1)) {
    const parts = line.trim().split(/\s+/).map(Number);
    const u = parts[0];
    const v = parts[1];
    if (
      parts.length < 2 ||
      !Number.isInteger(u) ||
      !Number.isInteger(v) ||
      u === undefined ||
      v === undefined
    ) {
      // Not an edge-list format (or a trailing blank); stop at the first
      // unparseable line rather than guessing.
      break;
    }
    edges.push([u, v]);
  }
  return { n, edges, header };
}

/**
 * Union-find validation: exactly n-1 edges, no cycle, one component.
 * Returns a human-readable problem description, or null when valid.
 */
export function validateTree(
  n: number,
  edges: [number, number][],
): string | null {
  // Endpoint range first: an out-of-range endpoint would corrupt the
  // union-find array, and a bare edge-count message would mask the cause.
  for (const [u, v] of edges) {
    if (u < 1 || u > n || v < 1 || v > n) {
      return `边 (${u}, ${v}) 的端点不在 1..${n} 范围内`;
    }
  }
  const parent: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      const grandparent = parent[parent[x] as number] as number;
      parent[x] = grandparent;
      x = grandparent;
    }
    return x;
  };
  for (const [u, v] of edges) {
    const a = find(u);
    const b = find(v);
    if (a === b) {
      const extra = edges.length !== n - 1 ? `，且边数 ${edges.length} ≠ n-1 = ${n - 1}` : "";
      return `边 (${u}, ${v}) 形成环（两点已连通）${extra}`;
    }
    parent[a] = b;
  }
  if (edges.length !== n - 1) {
    return `边数 ${edges.length} ≠ n-1 = ${n - 1}`;
  }
  let components = 0;
  for (let i = 1; i <= n; i += 1) {
    if (find(i) === i) {
      components += 1;
    }
  }
  if (components !== 1) {
    return `图不连通：${components} 个连通分量`;
  }
  return null;
}

/**
 * Run every declared generator case type once and validate the tree shape.
 *
 * Returns one diagnostic per broken case type. The generator is compiled and
 * executed inside the sandbox; a generator that fails to compile or run is
 * not this check's concern (the compile preflight and the verifier report
 * that), so those cases are skipped silently.
 */
export async function checkTreeData(
  problemId: string,
  config: ProblemConfig,
  runGenerator: (
    type: string,
    seed: number,
  ) => Promise<{ code: number; stdout: string } | null>,
  tags: string[] = [],
): Promise<string[]> {
  let statement: string;
  try {
    statement = await fs.readFile(problemPath(problemId, config.statement), "utf8");
  } catch {
    return [];
  }
  const { tree, reason } = isTreeProblem(tags, statement);
  if (!tree) {
    return [];
  }
  // The tags path is authoritative; the statement path is a fallback for
  // problems whose tags forgot the 树 tag. Both run the same validation.
  void reason;

  // One representative seed per distinct case type is enough: the branch
  // structure is shared, so a cycle-producing branch fails for every seed.
  const seen = new Set<string>();
  const cases = config.generator.cases.filter((c) => {
    if (seen.has(c.type)) return false;
    seen.add(c.type);
    return true;
  });

  const problems: string[] = [];
  for (const c of cases) {
    const result = await runGenerator(c.type, c.seed);
    if (!result || result.code !== 0) {
      continue; // Compile/run failures are reported elsewhere.
    }
    const parsed = parseTreeInput(result.stdout);
    if (!parsed) {
      continue; // Not an edge-list format we understand; stay silent.
    }
    const issue = validateTree(parsed.n, parsed.edges);
    if (issue) {
      problems.push(
        [
          `### generator 的 case type \`${c.type}\` 生成的不是树`,
          "```",
          `首行：${parsed.header}`,
          `问题：${issue}`,
          "```",
          reason === "tags"
            ? "本题的标签声明了树（tags 含「树」），但这个分支生成的数据不是树。"
            : "题面保证输入是一棵树，但这个分支生成的数据违反了该保证。",
          "两份标程在非树输入上的行为没有定义，验题会在数据语义层面失败，",
          "而错误信息不会指向真正的成因（generator 的构造分支）。",
          "",
          "请检查该分支的边构造：通常是链/挂枝的编号区间重叠，",
          "导致某个节点被连接了两次而形成环，或漏连了某个节点。",
        ].join("\n"),
      );
    }
  }
  return problems;
}
