/**
 * The built-in problem categories.
 *
 * A category is both the directory name under problems/ and the problem
 * family the architect leans towards. When the generate form is submitted
 * with an empty category, one of these is picked at random so a single
 * click produces a surprise problem.
 */

export type CategoryDefinition = {
  /** Directory name under problems/, lowercase with hyphens. */
  id: string;
  /** Chinese label shown in the registry. */
  label: string;
  /** One line on what this family is about, fed to the architect. */
  hint: string;
};

export const CATEGORIES: CategoryDefinition[] = [
  {
    id: "dp",
    label: "动态规划",
    hint: "动态规划：状态设计与转移，背包、区间、树形、状压等",
  },
  {
    id: "greedy",
    label: "贪心",
    hint: "贪心：交换论证、排序策略、反悔贪心等",
  },
  {
    id: "graph",
    label: "图论",
    hint: "图论：最短路、生成树、网络流、二分图、连通性等",
  },
  {
    id: "string",
    label: "字符串",
    hint: "字符串：哈希、KMP、后缀数组、自动机等",
  },
  {
    id: "xor",
    label: "异或",
    hint: "位运算与异或：线性基、trie 上的异或最值、按位贡献",
  },
  {
    id: "data-struct",
    label: "数据结构",
    hint: "数据结构：线段树、树状数组、平衡树、并查集、莫队等",
  },
  {
    id: "template",
    label: "模拟",
    hint: "模拟与实现：按题意精确建模，考察实现能力与边界处理",
  },
  {
    id: "construct",
    label: "构造",
    hint: "构造：给出一个满足条件的解的构造方案，或判定无解",
  },
  {
    id: "math",
    label: "数论",
    hint: "数论与数学：gcd、质数、同余、组合数学、快速幂等",
  },
];

/** Pick a random category definition. */
export function randomCategory(): CategoryDefinition {
  const index = Math.floor(Math.random() * CATEGORIES.length);
  return CATEGORIES[index] ?? CATEGORIES[0]!;
}
