import { describe, expect, it } from "vitest";

import {
  isTreeProblem,
  statementGuaranteesTree,
  tagsDeclareTree,
  validateTree,
} from "./tree-check";

describe("isTreeProblem (tags are the primary signal)", () => {
  it("a graph-tagged problem with a 树 tag is a tree problem", () => {
    // string-003's actual tags.
    expect(isTreeProblem(["树形DP", "最短路", "字符串"], "任意题面")).toEqual({
      tree: true,
      reason: "tags",
    });
    expect(isTreeProblem(["图论", "树", "LCA"], "任意题面")).toEqual({
      tree: true,
      reason: "tags",
    });
  });

  it("a graph-tagged problem WITHOUT a 树 tag is not a tree problem", () => {
    // graph-006's actual tags: a general-graph shortest path problem.
    // The architect deliberately did not declare a tree, so the check
    // trusts that and stays silent - even if the statement mentions trees.
    expect(isTreeProblem(["图论", "最短路", "分层图", "Dijkstra"], "题面提到树算法")).toEqual({
      tree: false,
      reason: "tags",
    });
  });

  it("tags with no tree information fall back to the statement", () => {
    expect(
      isTreeProblem(["贪心", "排序"], "## 题目描述\n\n给定一棵包含 $n$ 个节点的树。"),
    ).toEqual({ tree: true, reason: "statement" });
    expect(isTreeProblem(["贪心", "排序"], "## 题目描述\n\n给定一个序列。")).toEqual({
      tree: false,
      reason: "statement",
    });
  });
});

describe("tagsDeclareTree", () => {
  it("matches any tag containing 树", () => {
    expect(tagsDeclareTree(["树"])).toBe(true);
    expect(tagsDeclareTree(["图论", "生成树"])).toBe(true);
    expect(tagsDeclareTree(["图论", "最短路"])).toBe(false);
    expect(tagsDeclareTree([])).toBe(false);
  });
});

describe("statementGuaranteesTree", () => {
  it("detects an explicit tree guarantee", () => {
    expect(
      statementGuaranteesTree("## 题目描述\n\n给定一棵包含 $n$ 个节点的树。"),
    ).toBe(true);
    expect(
      statementGuaranteesTree("## 数据范围\n\n- 保证 $n-1$ 条边构成一棵树"),
    ).toBe(true);
    expect(statementGuaranteesTree("## 数据范围\n\n- 保证图是树")).toBe(true);
  });

  it("stays silent for general graphs and tree-algorithm problems", () => {
    expect(
      statementGuaranteesTree("## 题目描述\n\n给定一张 $n$ 个点 $m$ 条边的连通无向图。"),
    ).toBe(false);
    expect(
      statementGuaranteesTree(
        "## 题目描述\n\n给定一个序列。\n\n## 题解\n树上的距离定义为路径长。",
      ),
    ).toBe(false);
  });
});

describe("validateTree", () => {
  it("accepts a valid tree", () => {
    expect(validateTree(3, [[1, 2], [2, 3]])).toBeNull();
    expect(validateTree(1, [])).toBeNull();
  });

  it("rejects wrong edge counts", () => {
    expect(validateTree(3, [[1, 2]])).toContain("边数");
  });

  it("rejects cycles", () => {
    // string-003's original bug: chain 1-2-3 plus edge 1-3.
    expect(validateTree(3, [[1, 2], [2, 3], [1, 3]])).toContain("环");
  });

  it("rejects disconnected graphs", () => {
    // 4 nodes, 3 edges, but node 4 is isolated: two components.
    expect(validateTree(4, [[1, 2], [2, 3], [1, 3]])).toContain("环");
    expect(validateTree(5, [[1, 2], [2, 3], [1, 3], [4, 5]])).toContain("环");
  });

  it("rejects out-of-range endpoints", () => {
    expect(validateTree(2, [[1, 2], [2, 5]])).toContain("范围");
  });
});
