# 杂项算法与约定：几何 / 字符串算法 / 博弈 / 位运算 / 输出特判 / 交互

> 博弈打表与位运算的思考剧本见 `../thinking.md` §3.5–3.6。

覆盖前四个主题文件放不下的类别。多数是小类别（1–6 个文件），约定以"跟随代表文件 + 题面"为主，不要发明新规范。

## 计算几何（约 6 个真实样本）

第一轮统计的"几何 29 个文件"是宽松匹配（任何 `double`）；真用几何的文件约 6 个，且**多数是 2025 年带大段中文注释的学习型文件**（Allman 大括号、注释密集），例如 `nowcoder\108299\G.cpp`。可以抄的形态：

```cpp
const double eps = 1e-12;
const double pi = acos(-1.0);

int dcmp(double x,double y){
    if(fabs(x - y) < eps) return 0;
    if(x > y) return 1;
    else return -1;
}

pair<double,double> p0,p[N];
```

- 点用 `pair<double,double>` 或 `pair<int,int>`，不写 `struct Point`（全库 0 个）。
- `eps` 取值分层：几何判定 `1e-12`，实数二分 `1e-9`（三分）/ `1e-8`（01 分数规划）。
- 叉积直接内联在表达式里（`(p2.first - p1.first) * (pp0.second - p1.second) >= ...`），不抽 `cross()` 函数（全库 0 个）。
- **2026 年的"几何味"其实是概率/浮点 DP**：`long double dp[3100][3100];`（`QOJ\2026_shenzhen_Invitation\L.cpp`）。浮点状态表用 `long double` 而非 `double` 是升级方向。
- 浮点输出沿用 `cout<<fixed<<setprecision(k)`（19 个文件），k 跟题面（10 位也出现过）。

## 字符串算法

输入侧（`string` 一律、1-based 技巧）见 `everyday.md` 的字符串处理节。算法侧全库很薄：

- **string 转全局数组再下标**：`string s; cin>>s;` 后 `for(int i=1;i<=n;i++) c[i] = s[i - 1];`（14 个文件含 `= s[i-1]` 形拷贝；`char c[N]` 全局数组 4 个文件）。配套哨兵：`c[0] = '?'; c[n + 1] = '?';`（`ICPC\2025西安区域赛\B.cpp`）。
- **字符串哈希**（2 个文件）：把模板 `qpow` 改造成 `ull` 且**去掉取模**（`AtCoder\abc_428\D.cpp`），自然溢出哈希；拆位数组配合 `while(tmp){ len++; tmp /= 10; }`。
- **KMP**（5 个文件）：失配数组命名 `nxt[]`（不是 `ne[]`——`ne` 已被链式前向星占用！），代表 `codeforces\1060D.cpp`。
- **Manacher**：唯一模板 `Luogu\P3805-马拉车模板.cpp`，`while(cin>>s)` 的 EOF 读入。
- **trie**（2 个文件）：`son[N][26]` 式二维数组 + 字符下标，不写 `struct` 节点。
- 多项式/FFT：仅 `Luogu\P3803-多项式乘法模板.cpp` 一个，属孤本。

## 博弈论 SG 函数（3 个文件）

代表 `algorithm\SG函数计算\HDU-1848.cpp`：

```cpp
int f[N];   // 可行转移（本题为斐波那契数）
int sg[N];
int vis[N]; // 复用 vis 做 mex 标记，不新开 bool

// 预处理（该文件直接放在 signed main() 里、while(t--) 之前——预处理允许进 main）
for(int i=1;i<=1000;i++){
    for(int j=0;j<=1000;j++) vis[j] = 0;
    for(int j=1;f[j]<=i && j<=idx;j++) vis[sg[i - f[j]]] = 1;
    for(int j=0;;j++){
        if(!vis[j]){ sg[i] = j; break; }
    }
}
```

- **mex 三步**：清 `vis` → 标记后继 sg 值 → `for(int j=0;;j++)` 无上界循环找第一个没标记的。
- 判定直接异或：`if(sg[n] ^ sg[m] ^ sg[p])` 先手赢。
- 多组数据用**哨兵终止**：`while(true){ cin>>n>>m>>p; if(n==0 && m==0 && p==0) break; ... }`。
- ⚠️ 该文件是 2025 风格：入口 `Love_Hitachi_Mako`、Allman 大括号、输出用 `endl`。抄 SG 结构，别抄这三样。

## 位运算与移位

- **掩码常量写 `1ll << k`**（72 个文件），不写 `1 << k`（`int` 已是 64 位，但 `1ll` 是既定习惯）。
- 状态翻转用 `^= 1`（`nst ^= 1;`）；判位 `if(j & dig)`。
- `__builtin_popcount` / `__builtin_ctz` 仅 2 个文件——不主动引入。
- 位运算结论类笔记见根目录 `汇总题单.md` 的"位运算技巧"节（最高位分析法）。

## 输出特判约定

| 场景 | 规范 | 文件数 |
|---|---|---|
| 无解 / 不可达 | `cout<<-1<<"\n";` | **81** |
| 判定串 | `"YES"/"NO"` 与 `"Yes"/"No"` 都有（3 vs 1），**大小写跟随题面**，无自创规范 | 4 |
| 交互不可行 | `cout<<-1<<"\n"; return ;` | — |
| Case 编号 | 仅 1 个文件，不是习惯 | 1 |

- 无解特判配**提前退出**：`cout<<-1<<"\n"; return ;`（`return ;` 分号前留空格）。
- 网格 BFS 不可达判据是"仍等于无穷"：`if(dis[tx][ty][0] == dis[tx][ty][1] && dis[tx][ty][0] == MOD * MOD) cout<<-1<<"\n";`

## 交互题（约 5 个 flush 文件）

代表 `codeforces\1044\C.cpp`（2025 风格）：

```cpp
int num;
cin>>num;
fflush(stdout);
// ...
cout<<"? "<<i<<" "<<n<<" ";
for(int j=1;j<=n;j++) cout<<j<<" ";
cout<<"\n";
fflush(stdout);
```

- **刷新用 `fflush(stdout);`**（C 风格），不用 `endl` 也不用 `cout.flush()`；读入后、输出后各刷一次是常态。
- 查询行格式 `"? "<<...<<" "`，候选答案 `cout<<j<<" ";` 空格分隔，行尾 `"\n"` 再 flush。
- 交互题是 `endl`/flush 例外于 `"\n"` 规则的唯一正当场景。
