# DP 家族思路骨架

> 动笔前先读 `../thinking.md` §3.4 的 DP 思考剧本（定状态→树上合并→区间→矩阵化顺序→数位四参数）。

语料：161 个文件含 DP 特征（`dp[` / `memset(dp` / `f[i]`）。主要母题见下表；下列骨架均来自 `一些板子集合\DP\` 下的实际文件。

| 子型 | 代表文件 | 状态形态 |
|---|---|---|
| 数位 DP | `数位DP.cpp` | `dp[12][12]` 记忆化 |
| 状压 DP | `状压DP.cpp`、`洛谷P3052-状压DP.cpp` | `dp[1<<16][16]` |
| 区间 DP | `CF1132F-区间DP.cpp`、`CF607B-区间DP.cpp` | `dp[505][505]` |
| 背包 DP | `CF336C-背包DP.cpp`、`洛谷P2015-树上背包.cpp` | `dp[容量][2]` 滚动 |
| 换根 DP | `换根DP.cpp`、`洛谷P3047` | `dep[]/cnt[]/ans[]` 非 `dp` 名 |
| 斜率优化 | `洛谷T227976-斜率优化dp.cpp` | `dp[N]` + 单调队列 |
| SOS DP | `SOSDP*.cpp` | `dp[1<<18][2]` 最大/次大 |
| 矩阵加速 | `洛谷P1962-矩阵加速dp.cpp` | `struct Matrix` |

## 全家族统一外壳

9/9 代表文件完全一致：

```cpp
#define int long long         // 模板块
void solve() { ... }
signed main() {
    ios::sync_with_stdio(false);
    cin.tie(0);
    cout.tie(0);
    int t=1;
    //cin>>t;
    while(t--) {
        solve();
    }
    return 0;
}
```

模板的 `qpow`/`inv`/`lcm` 与 `mt19937 rng` 原样保留，**即使整个 DP 用不到也留着**。矩阵题另加一个同名重载 `Matrix qpow(Matrix m,int k)`。

## 五条共性

1. **状态一律全局。** DP 表写在模板块与 `solve()` 之间，尺寸用字面量（`dp[12][12]`、`dp[505][505]`、`dp[(1ll << 16)][16]`）。没有局部大数组，没有 `vector` 版 DP。通用数组仍保持 `int a[N]; int b[N];`。
2. **初始化二选一。** 要么靠全局零默认值（状压 / 背包 / 换根 / 斜率 / SOS / 树上背包 / 矩阵构造函数 `memset`），要么在 helper 内显式重置——数位 DP 用双层循环置 `-1`，区间 DP 用 `MOD * MOD` 当无穷。**`solve()` 内几乎不 `memset` 主表。**
3. **维度的命名按角色而非语义。** `i/j/k` + `len/mid`（区间）、`pos/last/st/limit`（数位）、`dig/dig1/dig2` + `mask`（状压）、`son/fa`（树）。
4. **递归 vs 迭代按题型分。** 树形与数位 DP 用递归 helper（`dfs(int x,int fa)` / `dfs1` 求 `siz`、`dep`，`dfs2` 换根）；区间 / 背包 / 状压 / SOS / 矩阵全部是三层以内的迭代。两者基本不混用。
5. **答案在末尾一次性输出。** `cout<<dp[...]<<"\n";` 或 `cout<<res<<"\n";`。只有 SOSDP 在循环内流式打印。多测重置靠「全局零 + `solve()` 内局部计数器」（如斜率优化的 `int h = 1; int t = 0;`），而不是清表。

## 分子型骨架

### 数位 DP

```cpp
int dp[12][12];//表示搜到第i位，前一位数字是j的方案数
int len;

int dfs(int pos,int last,int st,int limit){
    if(!limit && dp[pos][last] != -1) return dp[pos][last];   // 记忆化
    int ret = 0;
    int up = limit ? b[len - pos + 1] : 9;                    // 当前位上限
    for(int digit = 0;digit <= up;digit++){
        if(abs(digit - last) < 2) continue;
        ret += dfs(pos+1,digit,0,limit && digit == up);
    }
    if(!limit && !st) dp[pos][last] = ret;                    // 仅在无限制且无前导零时存
    return ret;
}

int count(int x){
    len = 0;
    while(x){ b[++len] = x % 10; x /= 10; }
    for(int i=0;i<=10;i++)
        for(int j=0;j<=10;j++)
            dp[i][j] = -1;                                    // 每次查询前重置
    return dfs(1,-2,1,1);
}
```

- **形态**：`dfs(pos, 前驱状态, 前导零标志 st, 限制标志 limit)` 四参数固定。
- **拆位数组复用 `b[]`**（模板通用数组），长度存全局 `len`。
- **答案**：区间差分 `cout<<count(r) - count(l - 1)<<"\n";`
- **命名**：`dp, pos, last, st, limit, ret, up, digit, b[], len, dfs, count`

### 状压 DP

- 状态：`int dp[(1ll << 16)][16];`（mask 下以 i 结尾），配套 `bool isans[(1ll << 16)];` 标记合法终态。
- 基态在**读入时**打：`dp[(1ll << (i - 1))][i] = 1;`
- 转移显式跳位：`dp[i][j + 1] += dp[i ^ dig1][k + 1]; dp[i][j + 1] %= MOD;`
- 答案累加：`if(isans[i]) res = (res + dp[i][j + 1]) % MOD;` 最后 `cout<<res<<"\n";`
- **无 `memset`**，靠全局零。
- 掩码常量写作 `(1ll << k)` 而非 `(1 << k)`。

### 区间 DP

- 状态：`int dp[505][505];`，长度维在外层。
- 无穷用 `dp[i][j] = MOD * MOD;` 初始化，长度 1 基态 `dp[i][i] = 1;`
- 三层固定顺序：

```cpp
for(int len = 2;len<=n;len++)
for(int i=1;i + len - 1 <= n;i++){
    int j = i + len - 1;
    // 相等合并
    dp[i][j] = min(dp[i][j],dp[i + 1][j]);
    // 否则枚举断点
    for(int mid = i;mid<j;mid++)
        dp[i][j] = min(dp[i][j],dp[i][mid] + dp[mid + 1][j]);
}
```

- 答案：`cout<<dp[1][n]<<"\n";`
- 字符串用 1-based 读入，访问写 `s[i - 1]`。

### 背包 DP（含树上背包）

- 滚动数组第二维当「本层暂存」，每轮结束回滚：

```cpp
dp[nxt][1] = max(dp[nxt][1],deli);
// ... 本轮结束后
dp[j][0] = max(dp[j][0],dp[j][1]),dp[j][1] = 0;
```

- 下标平移量存局部 `int base = 1e5 + 10;`，答案取 `dp[base][0]`。
- **树上背包**用倒序容量维，两维上界都被 `siz[]` 裁剪：

```cpp
for(int j=min(m,siz[x]);j;j--)
    for(int k=0;k<=min(j - 1,siz[son]);k++)
        dp[x][j] = max(dp[x][j],dp[x][j - k - 1] + dp[son][k] + w[i]);
```

- 树上背包把 `n,m` 声明为**全局**，与通用的 `a[N]/b[N]` 并列。

### 换根 DP

- **不使用 `dp` 这个名字**，而是语义名 `dep[]`、`cnt[]`、`ans[]`，外加 `int maxvalue = 0;`
- 两趟 DFS 分工固定：`dfs1` 自底向上求 `dep`/`cnt`；`dfs2` 自顶向下换根

```cpp
void dfs1(int x,int fa){
    dep[x] = dep[fa] + 1;
    cnt[x] = 1;
    for(int i=h[x];i;i=ne[i]){
        int son = e[i];
        if(son != fa){ dfs1(son,x); cnt[x] += cnt[son]; }
    }
}

void dfs2(int x,int fa){
    if(x != 1) ans[x] = ans[fa] - cnt[x] + cnt[1] - cnt[x];
    maxvalue = max(maxvalue,ans[x]);
    for(int i=h[x];i;i=ne[i]){
        int son = e[i];
        if(son != fa) dfs2(son,x);
    }
}
```

- 根固定为 1，先算 `ans[1]` 再下推。

### 斜率优化

- `int dp[N]; int pre[N]; int q[N];//模拟队列`，队列指针 `int h = 1; int t = 0;` 在 `solve()` 内（随用例重置）。
- `double slope(int i,int j)` 单独成函数，返回斜率。
- 转移三步：弹尾 → 入队 → 弹头定最优 j：

```cpp
while(h < t && slope(i - 1,q[t]) <= slope(q[t],q[t - 1])) t--;
q[++t] = i - 1;
while(h < t && slope(q[h + 1],q[h]) <= 2 * pre[i]) h++;
int j = q[h];
dp[i] = dp[j] + (pre[i] - pre[j]) * (pre[i] - pre[j]) + m;
```

- **多测不走 `main` 的 t 循环**，而在 `solve()` 内 `while(cin>>n){ cin>>m; ... }`。

### SOS DP

- 状态 `int dp[(1ll << 18)][2];` 存每个 mask 的最大 / 次大。
- 外层枚举位、内层枚举 mask，用 `if(j & dig)` 只更新含该位的：

```cpp
for(int i=0;i<18;i++){
    int dig = (1ll << i);
    for(int j=0;j<(1ll << 18);j++){
        if(j & dig){
            if(dp[j][0] < dp[j ^ dig][0]) dp[j][1] = dp[j][0],dp[j][0] = dp[j ^ dig][0];
        }
    }
}
```

- 唯一在循环内流式输出的子型：`ans[i] = max(ans[i],dp[i][0] + dp[i][1]); cout<<ans[i]<<"\n";`

### 矩阵加速

- `struct Matrix` 带默认构造函数 `Matrix(){ memset(m,0,sizeof m); }`；下标 **1-based**：`m[3][3]` 只用 1..2。
- 手写 `operator *`，`% MOD` 在三重循环内逐次累加。
- 重载模板名：`Matrix qpow(Matrix m,int k)`，与整型 `qpow` 共存。
- 早退处理边界：`if(n <= 2){ cout<<1<<"\n"; return ; }`

## 偏差记录

- `数位DP.cpp`、`换根DP.cpp` **缺 ASCII 头**（第 1 行直接是 `#include<bits/stdc++.h>`）。抄算法可以，别抄文件框架。
- `数位DP.cpp` 同时缺 `#define ull` 且 `lowbit(x)` 未加括号——这是 2026 年模板升级前的写法。
- `洛谷P1962` 的裸 `qpow` 名字被矩阵版复用，属于重载而非覆盖，是有意为之。
- `CF336C-背包DP.cpp` 用 `deli`、`ca`、`nxt` 这类短名，是全库里少见的非语义缩写。
