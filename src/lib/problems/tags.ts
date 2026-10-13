/**
 * Fine-grained algorithm tags, grouped by category.
 *
 * The generate form offers these as a multi-select so the architect gets a
 * precise direction ("最短路" rather than a free-text guess). The group ids
 * deliberately match CATEGORIES ids so the UI can highlight the group that
 * matches the selected category; a tag may appear under several groups when
 * it genuinely belongs to both (e.g. 树形DP under dp and data-struct).
 */

export type TagGroup = {
  /** Matches a CATEGORIES id when the group is a problem category. */
  id: string;
  label: string;
  tags: string[];
};

export const TAG_GROUPS: TagGroup[] = [
  {
    id: "dp",
    label: "动态规划",
    tags: [
      "背包",
      "区间DP",
      "树形DP",
      "状压DP",
      "数位DP",
      "概率DP",
      "斜率优化",
      "决策单调性",
      "数据结构优化DP",
    ],
  },
  {
    id: "greedy",
    label: "贪心",
    tags: [
      "排序贪心",
      "交换论证",
      "反悔贪心",
      "区间调度",
      "枚举断点",
    ],
  },
  {
    id: "graph",
    label: "图论",
    tags: [
      "最短路",
      "最小生成树",
      "网络流",
      "二分图匹配",
      "强连通分量",
      "双连通分量",
      "拓扑排序",
      "最近公共祖先",
      "树上差分",
      "欧拉回路",
      "图的匹配",
    ],
  },
  {
    id: "string",
    label: "字符串",
    tags: [
      "字符串哈希",
      "KMP",
      "AC自动机",
      "后缀数组",
      "后缀自动机",
      "Manacher",
      "Trie",
      "Z函数",
    ],
  },
  {
    id: "xor",
    label: "异或",
    tags: [
      "线性基",
      "01-Trie",
      "按位贡献",
      "异或方程组",
    ],
  },
  {
    id: "data-struct",
    label: "数据结构",
    tags: [
      "线段树",
      "树状数组",
      "平衡树",
      "并查集",
      "莫队",
      "分块",
      "ST表",
      "单调栈",
      "单调队列",
      "堆",
    ],
  },
  {
    id: "template",
    label: "模拟",
    tags: [
      "精确模拟",
      "状态机",
      "扫描线",
    ],
  },
  {
    id: "construct",
    label: "构造",
    tags: [
      "构造方案",
      "判定无解",
      "打表找规律",
    ],
  },
  {
    id: "math",
    label: "数论",
    tags: [
      "gcd与lcm",
      "质数与筛法",
      "同余与CRT",
      "组合数学",
      "快速幂",
      "矩阵快速幂",
      "博弈论",
      "多项式",
    ],
  },
];

/** All distinct tags across groups, for validation. */
export const ALL_TAGS: string[] = [
  ...new Set(TAG_GROUPS.flatMap((g) => g.tags)),
].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

/** Pick a random tag from a group (used when the user leaves it empty). */
export function randomTagFrom(groupId: string): string | null {
  const group = TAG_GROUPS.find((g) => g.id === groupId);
  if (!group || group.tags.length === 0) return null;
  return group.tags[Math.floor(Math.random() * group.tags.length)] ?? null;
}
