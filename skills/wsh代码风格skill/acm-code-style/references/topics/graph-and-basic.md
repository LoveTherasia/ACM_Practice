# 图论与基础算法思路骨架

> 思考剧本见 `../thinking.md` §3.7（树→子树/换根、虚拟节点建边、连通 BFS）。

语料：67 个文件含链式前向星邻接，71 个含 `priority_queue`/`dist[]`，29 个含树上变量（`dep`/`sz`/`son`/`dfn`），58 个含二分。代表文件在 `一些板子集合\图论\` 与 `一些板子集合\基础算法\` 下。

## 链式前向星：全库最稳定的惯用法

58 个文件使用同一行逗号链式赋值，是整份语料里最不变的结构：

```cpp
int e[N],ne[N],h[N];
int idx;

void add(int x,int y)
{
    e[++idx] = y,ne[idx] = h[x],h[x] = idx;
}
```

带权版本只在尾部追加一项，签名变 `void add(int x,int y,int z)`：

```cpp
void add(int x,int y,int z){ e[++idx] = y,ne[idx] = h[x],h[x] = idx,w[idx] = z; }
```

**只有这两种 arity**，没有 `add` 的第三个变体。无向边一律连着调两次 `add(x,y); add(y,x);`

遍历循环的写法也固定，子节点变量一律叫 `son`：

```cpp
for(int i=h[x];i;i=ne[i]){
    int son = e[i];
    if(son != fa) dfs(son,x);
}
```

## 递归签名：`dfs(int x,int fa)` 是树题主流，但不是全局规则

26 个文件出现 `dfs(int x,int fa)`，29 个文件用 `if(son != fa)` 防止回访。这是**树型题**的默认形态。但以下情形不同：

- **Tarjan / 2-SAT** 写 `void tarjan(int x)`，不用 `fa`，靠 `if(!dfn[son])` 判断未访问：

```cpp
void tarjan(int x){
    dfn[x] = low[x] = ++tim;
    sta[++top] = x;
    for(int i=h[x];i;i=ne[i]){
        int son = e[i];
        if(!dfn[son]){ tarjan(son); low[x] = min(low[x],low[son]); }
        else if(!scc[son]) low[x] = min(low[x],dfn[son]);
    }
    if(dfn[x] == low[x]){
        cnt ++;
        do{ int j = sta[top--]; scc[j] = cnt; }while(j != x);
    }
}
```

- **分治 / 折半搜索**用 `(l, r, ...)` 区间参数，形式是 `void cal(int l,int r)`、`void dfs(int l,int r,int sum,int op)`。

所以「DFS 一定带 fa」是错的；正确说法是**树题带 fa，图题用 `dfn` 标记，区间题带 `(l,r)`**。

## 二分：一律用左闭右开式 `while(l < r)`

全库统计：`while(l < r)` **55 个文件**，而 `while(l <= r)` 只有 **4 个**。整数二分默认写成：

```cpp
int l = 1,r = n;
while(l < r){
    int mid = (l + r + 1) >> 1;   // 右偏，取最后一个满足条件的
    if(check(mid)) l = mid;
    else r = mid - 1;
}
```

实数域搜索则换成 `while(r - l > eps)`，`eps` 取 `1e-9`（三分）或 `1e-8`（01 分数规划）。全库仅 2 个文件用这个形态——**遇到实数题就用它，不要用整数二分套 eps**。

判定函数的固定签名是 `bool check(...)`（7 个文件），放在 `solve()` 之前，返回 `true`/`false` 而非 0/1：

```cpp
bool check(int l,int r){
    for(int i=0;i<3;i++){
        if((pre[r][i] - pre[l - 1][i]) > (r - l + 1) / 2 + (r - l + 1) % 2) return false;
    }
    return true;
}
```

- 三分 / 01 分数规划的目标函数则叫 `double f(...)`（见下文）——`check` 管可行性判定，`f` 管求值。

## 分子型骨架

### 树的直径

- 树形 DP 而非两次 BFS：维护 `maxvalue1[N]`、`maxvalue2[N]`（最长 / 次长链）。
- 答案是 `cout<<maxvalue1[1] + maxvalue2[1]<<"\n";`
- ⚠️ 该文件内部不自洽：比较时写 `maxvalue1[son] + w[i]`，赋值时写 `maxvalue1[son] + 1`。抄结构时统一用边权 `w[i]`。

### 同余最短路

- 0-based 余数建图：余数 `i` 向 `(i + j) % minvalue` 连边，边权 `j`。
- 堆优化 Dijkstra，`priority_queue< pair<int,int> , vector< pair<int,int> > , greater<> >q;`
- 用 C++17 结构化绑定取堆顶：`auto [dis,pos] = q.top();`
- 无穷用 `MOD * MOD`；`dp[]` 存最短路，最后扫一遍取 `maxvalue = max(maxvalue,dp[i] - minvalue)`。
- 早退：`if(minvalue <= 1){ cout<<-1<<"\n"; return ; }`

### 堆优化 Dijkstra（标准形态）

先纠正一个预期：全库 **0 个文件**把函数命名为 `dijkstra`——Dijkstra **不写成独立函数**，而是内联在 `solve()` 里。标准形态（`AtCoder\abc_463\E.cpp`，2026-09）：

```cpp
int e[N],ne[N],h[N],w[N];
int idx;

int dist[N];

void add(int x,int y,int z){
    e[++idx] = y,ne[idx] = h[x],h[x] = idx,w[idx] = z;
}

void solve() {
    // ... 读入建边；dist 初值在读入循环里顺手赋：
    for(int i=1;i<=n;i++){
        dist[i] = MOD * MOD;
        cin>>a[i];
        add(i,n + 1,2 * a[i] + y);
        add(n + 1,i,2 * a[i] + y);
    }

    priority_queue< pair<int,int> , vector< pair<int,int> > , greater<> >q;
    q.push({0,1});
    dist[1] = 0;

    while(!q.empty()){
        auto [cost,pos] = q.top();
        q.pop();
        if(cost > dist[pos]) continue;

        for(int i=h[pos];i;i=ne[i]){
            int son = e[i];
            int ncost = cost + w[i];

            if(ncost < dist[son]){
                dist[son] = ncost;
                q.push({ncost,son});
            }
        }
    }
}
```

- **无穷大是 `MOD * MOD`**（全库 73 个文件的标准写法）；`0x3f` 全库 **0** 个文件，`1e18` 只有 15 个。
- **堆声明的模板参数间带空格、比较器是 `greater<>`**：`priority_queue< pair<int,int> , vector< pair<int,int> > , greater<> >q;` 是全库唯一稳定拼法（出现 11 次）。不要写成紧凑的 `greater<pair<int,int>>>`。
- **过期堆顶跳过**：`if(cost > dist[pos]) continue;`——用 `continue`，不用 `vis[]` 标记。
- **结构化绑定取堆顶**：`auto [cost,pos] = q.top();`（也有写 `[dis,pos]` 的文件）。
- 松弛值先存局部 `ncost` 再比较、再入队。
- 反过来注意：`priority_queue< pair<int,int> ,vector< pair<int,int> > >q;`（**不带 greater 的大根堆**）才是全库更常见的用法（73 个 pq 文件里多数是贪心模拟取最大，如 `CCPC\2026_shaanxi邀请赛\H.cpp`）；带 `pair` + `greater<>` 的小根堆只有 21 个文件。写最短路时才加 `greater<>`。
- 多测时 `dist` 不 `memset`，每轮在读入循环里重新赋 `MOD * MOD` 覆盖。

### BFS（queue<int>）

- 队列一律 STL `queue<int>`（51 个文件）；数组模拟 `q[++t]` 只在斜率优化的单调队列里出现过 1 次。
- 循环条件写 `while(!q.empty())`（73 个文件），几乎不写 `while(q.size())`（1 个文件）。
- 多条队列直接声明**全局**并编号：`queue<int>q1; queue<int>q2;`（`nowcoder\每日打卡\2026-09-30.cpp`）；当前点变量名用 `now`。
- 网格 BFS 用 `pair` 存坐标 + 结构化绑定出队：`auto [x,y] = q.front(); q.pop();`（5 次出现）。
- 入队同时打访问标记：`q.push(son); vis[son] = 1;`（`vis[]` 全库 75 个文件）。

### 网格 BFS / Dijkstra（dx/dy 方向数组）

22 个文件用方向数组，标准形态（`AtCoder\abc_420\D.cpp`，2026）：

```cpp
char a[505][505];
int dis[505][505][2];      // 第三维是附加状态

int dx[4] = {0,1,0,-1};
int dy[4] = {1,0,-1,0};

// —— solve() 内 ——
for(int i=1;i<=n;i++)
    for(int j=1;j<=m;j++){
        dis[i][j][0] = dis[i][j][1] = MOD * MOD;
        cin>>a[i][j];
        if(a[i][j] == 'S') sx = i,sy = j;
        else if(a[i][j] == 'G') tx = i,ty = j;
    }

priority_queue< array<int,4> , vector< array<int,4> > , greater<> >q;
dis[sx][sy][0] = 0;
q.push({0,0,sx,sy});

while(!q.empty()){
    auto [cost,st,x,y] = q.top();
    q.pop();

    for(int i=0;i<4;i++){
        int nx = x + dx[i];
        int ny = y + dy[i];

        if(nx >= 1 && nx <= n && ny >= 1 && ny <= m){
            if(a[nx][ny] == '#') continue;
            // ... 状态转移；不可达输出 -1
        }
    }
}
```

- 网格本体是**固定尺寸二维数组** `char a[505][505]`（按题面上界开），不是 `vector<string>`。
- 方向数组 `dx[4]/dy[4]` 声明为全局，配 `nx/ny`（next 坐标）、`nst`（next 状态）命名；**越界判断 1-based**：`nx >= 1 && nx <= n`。
- 多状态最短路把状态并进 `dis[x][y][状态]`，堆元素是 `array<int,4>`（cost、状态、x、y），四元组结构化绑定 `auto [cost,st,x,y] = q.top();`。
- 读入时顺手找起点终点（`'S'`/`'G'` 比较后记录 `sx,sy,tx,ty`）；不可达判"仍等于 `MOD * MOD`"后输出 `-1`。
- 无权网格用 `queue` 版同构写法，`dis` 初始化仍在读入循环里做。

### 2-SAT

- 建图用位移技巧：`add(pos1 + !num1 * n,pos2 + num2 * n)`，镜像边紧跟一行。
- 判定与输出写死字符串：`cout<<"IMPOSSIBLE\n";` / `cout<<"POSSIBLE\n";` 大写，跟随题面。
- 赋值方案用 `scc[i] > scc[i + n]` 比较。

### 三分

- 目标函数单独成函数：`double f(int n,double x)`，内部 `max` 扫全部二次函数。
- 三等分点写成 `lmid = (2 * l + r) / 3`、`rmid = (l + 2 * r) / 3`，**不是** `l + (r-l)/3`。
- 判据 `if(f(n,lmid) < f(n,rmid)) r = rmid; else l = lmid;`
- 输出带精度：`cout<<fixed<<setprecision(4)<<f(n,l);`

### 分块

- `build()` 里 `block = (int)sqrt(n)`、`tot = (n + block - 1) / block`、`belong[i] = (i - 1) / block + 1`
- 维护 `L[]`、`R[]`、`lazy[]`、`sum[]` 四件套，块内另存排序副本 `b[]` 供 `lower_bound`
- 部分块暴力 + `memcpy` 回写再重排；整块只动 `lazy[i] += k,sum[i] += k`
- **该文件把 `n,q,x,y,k` 声明为文件作用域全局**，helper 直接读，不传参——这是分块题特有的偷懒形态，别推广到其他题型。

### 倍增

- 结构体带成员比较器：

```cpp
struct Node{ int l; int r; int idx; bool operator < (const Node &other){ return this->l < other.l; } }node[N];
```

- 断环成链：`node[i + n]` 复制一份并 `+m`，保留原 `idx`
- 双指针预处理 `st[i][0]`（`while(r + 1 <= 2 * n && node[r + 1].l <= node[i].r) r++;`）
- 倍增递推 `st[j][i] = st[st[j][i-1]][i-1];`，第二维到 20 或 22
- 下跳时 `res += (1ll << j);`，答案特意 `+2`

### 折半搜索

- `void dfs(int l,int r,int sum,int op)` 一个函数用 `op` 区分两半，超出上界就 `if(sum > m) return ;` 剪枝
- 两半结果分别写进 `ans1[++cnt1]` / `ans2[++cnt2]`，数组开 `2 * N`
- 后半排序后对前半每个值二分，二分用右偏形态：

```cpp
while(l < r){
    int mid = (l + r + 1) >> 1;
    if(ans1[i] + ans2[mid] <= m) l = mid;
    else r = mid - 1;
}
res += l;
```

### 分治（归并求逆序对）

- 递归壳 `void merge(int l,int r)`：`if(l >= r) return ;` → 递归两半 → 调 `cal(l,r)`
- 合并逻辑单独放 `void cal(int l,int r)`，用局部 `vector<int>v` 做归并缓冲，最后 `a[j] = v[j - l];`
- 逆序对累加到全局 `int res`：`res += (r - rp + 1);`
- ⚠️ 该函数名 `merge` 遮蔽了 `std::merge`，属于有意重名。

### 01 分数规划

- 实数二分 `while(r - l > eps)`，每轮重算 `d[i] = (double)a[i] - mid * (double)b[i]` 并 `sort(d + 1,d + n + 1,greater<double>())`
- 取前 `m` 大求和，`if(sum >= 0.0) l = mid; else r = mid;`
- 输出 `cout<<fixed<<setprecision(3)<<l;`

## 共性小结

- **堆与队列的声明拼法**：模板参数间带空格（`pair<int,int> , vector< pair<int,int> >`）；循环一律 `while(!q.empty())`。
- **helper 是自由函数**，签名实参化：`int f(int n,double x)`、`void build()`、`void modify_part(int bid,int st,int ed)`、`void cal(int l,int r)`、`int find(int x)`。唯一例外是分块（读全局）；Dijkstra 也是例外——它不抽函数，直接内联在 `solve()`。
- **入口一律 `solve()`**，10/10；外壳一律 `signed main()` + `int t=1;` + `while(t--) { solve(); }`。
- **输出纪律**：普通量 `cout<<x<<"\n"`；浮点 `cout<<fixed<<setprecision(k)`；数组空格分隔且末尾补 `"\n"`。
- **调试**注释保留：`//cout<<now<<" "<<j<<" "<<st[now][j]<<" "<<node[st[now][j]].r<<"\n";`
- 多测：10 个代表文件里 9 个把 `cin>>t;` 注释掉，只有三分那道是活的——**默认按单测写，注释掉 `cin>>t;`**。
