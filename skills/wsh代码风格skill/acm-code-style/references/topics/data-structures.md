# 数据结构思路骨架

> 选型决策树见 `../thinking.md` §3.8；本文件只讲怎么写。

语料：29 个文件含线段树特征，27 个含并查集，15 个含树状数组，另有主席树 / 树链剖分 / 莫队 / 珂朵莉树 / 线性基 / 矩阵快速幂等孤立实现。代表文件在 `一些板子集合\数据结构\` 与 `algorithm\` 下。

> **重要前提**：本目录 9 个代表文件中只有 5 个带 ASCII 头（41 行 `//` 画 + 1 行空行）。`线段树.cpp`、`线段树维护区间gcd.cpp`、`线性基.cpp`、`矩阵快速幂.cpp` 都**没有**头——不能无脑 `-Skip 42` 读取，否则会吃掉代码头部。判断方法是检查前 42 行是否全为 `//` 或空行。

## 全局存储形态：全局数组优先

除树状数组外，全部用**全局 `N` 大小数组**而非 `struct`。

```cpp
int tree[N];
int tag[N];   // 或 lz[]
```

`struct` 封装只出现在两类场合：树状数组（`struct Tree{...}t;` 以实例调成员）和矩阵（`struct Matrix`）。全库 `struct` 定义仅 61 个文件（5.4%）。

## 区间参数的两种顺序

这是本目录最容易写错的一点，两种顺序都有实例：

| 顺序 | 用途 | 代表 |
|---|---|---|
| `(l, r, p, pl, pr)` | 查询区间在前，节点区间在后 | `线段树.cpp`、树链剖分 |
| `(p, l, r, pl, pr)` | 节点在前，节点区间随后 | `线段树维护区间gcd.cpp` |

三种函数的固定写法（以 `(l,r,p,pl,pr)` 为例）：

```cpp
void build(int p,int l,int r)        // 建树只有节点区间
void push_up(int p)                  // 只吃节点号
void push_down(int p,int l,int r)    // 下传要吃节点区间才能算长度
void addtag(int p,int l,int r,int d) // 打标记
void update(int l,int r,int p,int pl,int pr,int d)
int  query(int l,int r,int p,int pl,int pr)
```

## 分子型骨架

### 线段树（带懒标记，主流形态）

- 建树与更新分离，`mid` 一律 `(l + r) >> 1`，左右儿子写 `p * 2` / `p * 2 + 1`（不用 `p << 1 | 1`）。
- 完整命中的判断是独立的 `if` 加 `return ;`，不用 `else` 包住：

```cpp
void update(int l, int r, int p, int pl, int pr, int d)
{
    if (l <= pl && r >= pr)
    {
        addtag(p, pl, pr, d);
        return;
    }
    push_down(p, pl, pr);
    int mid = (pl + pr) >> 1;
    if (l <= mid) update(l, r, p * 2, pl, mid, d);
    if (r > mid) update(l, r, p * 2 + 1, mid + 1, pr, d);
    push_up(p);
}
```

- 查询用局部 `int res = 0;` 累加，左右各判一次 `if` 后 `return res;`
- 主流程：`build(1,1,n);` → 读操作循环 → `cout<<query(...)<<"\n";`

### 线段树维护区间 gcd

- 参数顺序反转为 `(p,l,r,pl,pr)`。
- 查询**不用 `res` 累加器**，而是两个具名变量 `num1`、`num2` 分别承接左右结果，最后 `__gcd(num1,num2)` 合并。

### 树状数组

- 唯一使用 `struct` 实例的形态：

```cpp
struct Tree{
    int sums[N];
    void update(int i,int x){ for(;i<=n;i += lowbit(i)) sums[i] += x; }
    int query(int i) const{
        int sum = 0;
        while(i > 0){ sum += sums[i]; i -= lowbit(i); }
        return sum;
    }
};
```

- 成员函数标 `const`；`lowbit` 直接用模板宏。
- 调用侧建两个实例做二维计数：`Tree r(q + 2); Tree c(q + 2);`

### 并查集

```cpp
int find(int x){
    if(x != fa[x]) fa[x] = find(fa[x]);
    return fa[x];
}
```

- 递归路径压缩，`fa[]` + `sz[]` 全局；初始化合并进循环：`for(int i=1;i<=n;i++) fa[i] = i,sz[i] = 1;`

### 线性基

- `update()` 这个名字被复用为**插入**（与线段树的 `update` 语义不同）。
- `prework()` 做高斯消元预备；`getmx()` / `getkth(int n,int k)` 取名直白。
- 位宽循环写 `for(int i=60;i>=0;i--)`，移位加 `1ll`：`p[i] & (1ll << j - 1)`。

### 矩阵快速幂

- `struct Matrix` 构造函数 `memset` 清零，另有一个 `Matrix(int x)` 形式构造单位阵。
- `const int MOD` 被**改写**为题目模数（如 `2009`），不是默认的 `1e9+7`。
- `qpow` 重载为矩阵版本。
- 注意：该文件末次输出**缺 `"\n"`**，属于笔误，不要模仿。

### 莫队

- `struct node` 带成员 `operator<`，排序键是 `belong[l]` 分块后按 `r` 奇偶。
- 全局 `int res`，配合单个 `void change(int pos,int op)` 做增删。
- 块大小 `block = sqrt(n)`，`belong[i] = (i - 1) / block + 1`。

### 珂朵莉树

- `set<node>` 配 `#define IT set<node>::iterator` 宏。
- **该文件的 `solve()` 是空的**（`void solve(){}`），只留了数据结构那一半。

### 主席树（可持久化权值线段树）

代表 `洛谷P3834-主席树.cpp`（静态区间第 k 小）：

```cpp
int tree[5 * N];//值域内的数字个数之和
int ch[5 * N][2];//0表示左子节点，1表示右子节点
int root[5 * N];//表示每个版本的根节点
int tot;
vector<int>v;   //离散化容器

void build(int &x,int l,int r){
    x = ++tot;
    if(l == r) return ;
    int mid = (l + r) >> 1;
    build(ch[x][0],l,mid);
    build(ch[x][1],mid + 1,r);
}

void insert(int x,int &y,int l,int r,int v){
    y = ++tot;
    tree[y] = tree[x];
    tree[y] ++;
    ch[y][0] = ch[x][0];
    ch[y][1] = ch[x][1];//赋值左右节点，后续再修改
    if(l == r) return ;
    int mid = (l + r) >> 1;
    if(v <= mid) insert(ch[x][0],ch[y][0],l,mid,v);
    else insert(ch[x][1],ch[y][1],mid + 1,r,v);
}

int query(int x,int y,int l,int r,int k){
    if(l == r) return l;
    int mid = (l + r) >> 1;
    int value = tree[ch[y][0]] - tree[ch[x][0]];
    if(k <= value) return query(ch[x][0],ch[y][0],l,mid,k);
    else return query(ch[x][1],ch[y][1],mid + 1,r,k - value);
}
```

- **孩子用 `ch[x][2]` 二维数组**，不是 `ls[]/rs[]`；版本根 `root[]`；节点计数 `tot`。
- 修改走**引用参数**：`insert(int x,int &y,...)`，逐节点复制再改。
- **离散化是 `vector` + `sort` + `erase(unique(...))` + `lower_bound`，结果 `+1` 保 1-based**（`lower_bound(...) - v.begin() + 1`）。
- 查询 `query(root[l - 1],root[r],...)` 版本相减。
- ⚠️ 已知偏差：该文件**缺 `#define int long long`** 却仍写 `signed main()`。抄结构时补回 define。

### 树链剖分

全库仅 1 个文件真正实现（`洛谷P3384-树链剖分.cpp`），数组命名与线段树一致、可直接沿用：

```cpp
int tree[N];   // 建在 dfs 序上，配 tag[N]
int fa[N];     // 父节点
int id[N];     // 每个节点的 dfs 序号（注意：叫 id，不叫 dfn）
int sz[N];     // 子树大小
int nw[N];     // 新编号（dfs 序位置）对应的值
int son[N];    // 重儿子
int dep[N];    // 深度
int top[N];    // 所在重链的根节点
int cnt;       // dfs 序计数器
int P;         // 运行时读入的模数
```

- 两趟 DFS 分工：`dfs1` 求 `fa/dep/sz/son`，`dfs2` 求 `id/top/nw`。
- 路径/子树查询全部转成 dfs 序上的区间，交给同文件的线段树（参数顺序 `(l,r,p,pl,pr)`，查询区间在前）。
- 模数运行时给定时写作全局 `int P`，取模 `% P` 每次累加后进行。
- 数组语义注释（`//记录每个节点的父节点`）在此类多数组模板中是**被接受**的注释例外。

## 取模

数据结构的取模出现得很少，且各不相同：

- 树链剖分：运行时读入模数 `% P`，每次累加后都取模。
- 珂朵莉树、矩阵快速幂：`% MOD`。
- 线段树、树状数组、并查集等：**运算内不取模**。

不要给线段树默认加 `% MOD`。

## 偏差记录

| 文件 | 偏差 |
|---|---|
| `数据结构\线段树.cpp` | 外部模板：`#include<iostream>`、Tab 缩进、Allman 大括号、`cin >> x` 带空格、无 `solve()`、`N=100010`、`tree[N<<2]`、无 MOD |
| `线性基.cpp` | `#define lowbit(x) x&(-x)` 未加括号（其余板子已加） |
| `洛谷P3834-主席树.cpp` | 缺 `#define int long long`，却仍写 `signed main()` |
| `矩阵快速幂.cpp` | `MOD=2009`；末行输出缺 `"\n"` |
| `洛谷P4782-2-SAT.cpp` | SCC 块用 Tab 缩进 |

结论：**抄这些文件的算法，不要抄它们的外框。** 新写的板子一律套 `references/boilerplate.cpp` 的当代模板。
