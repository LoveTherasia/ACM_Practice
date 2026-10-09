#include <bits/stdc++.h>

using namespace std;

namespace {

const int INF = 1e9;

int cross_edges(int upper, int lower) {
    if (lower == 0) {
        return 0;
    }
    return (upper == lower) ? (3 * lower - 2) : (3 * lower - 1);
}

}  // namespace

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n = 0;
    int k = 0;
    cin >> n >> k;
    int mines = k * k;

    vector<vector<int>> degree_prefix(n, vector<int>(n + 1, 0));
    for (int r = 0; r < n; ++r) {
        for (int c = 0; c < n; ++c) {
            int deg = 0;
            for (int dr = -1; dr <= 1; ++dr) {
                for (int dc = -1; dc <= 1; ++dc) {
                    if (dr == 0 && dc == 0) {
                        continue;
                    }
                    int nr = r + dr;
                    int nc = c + dc;
                    if (0 <= nr && nr < n && 0 <= nc && nc < n) {
                        ++deg;
                    }
                }
            }
            degree_prefix[r][c + 1] = degree_prefix[r][c] + deg;
        }
    }

    vector<vector<int>> dp(mines + 1, vector<int>(n + 1, INF));
    dp[0][0] = 0;

    for (int row = 0; row < n; ++row) {
        vector<vector<int>> next_dp(mines + 1, vector<int>(n + 1, INF));
        for (int used = 0; used <= mines; ++used) {
            for (int prev = 0; prev <= n; ++prev) {
                if (dp[used][prev] == INF) {
                    continue;
                }
                int limit = min(row == 0 ? n : prev, mines - used);
                for (int cur = 0; cur <= limit; ++cur) {
                    int add = degree_prefix[row][cur];
                    if (cur > 0) {
                        add -= 2 * (cur - 1);
                        if (row > 0) {
                            add -= 2 * cross_edges(prev, cur);
                        }
                    }
                    next_dp[used + cur][cur] = min(next_dp[used + cur][cur], dp[used][prev] + add);
                }
            }
        }
        dp.swap(next_dp);
    }

    int best_cut = INF;
    for (int last = 0; last <= n; ++last) {
        best_cut = min(best_cut, dp[mines][last]);
    }

    cout << 2LL * best_cut << '\n';
    return 0;
}
