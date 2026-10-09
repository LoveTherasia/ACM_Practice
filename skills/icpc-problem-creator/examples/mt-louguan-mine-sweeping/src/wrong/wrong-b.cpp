#include <bits/stdc++.h>

using namespace std;

namespace {

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

    vector<int> rows;
    rows.reserve(n);
    while (mines > 0) {
        int take = min(n, mines);
        rows.push_back(take);
        mines -= take;
    }
    while ((int)rows.size() < n) {
        rows.push_back(0);
    }

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

    int cut = 0;
    for (int r = 0; r < n; ++r) {
        int cur = rows[r];
        cut += degree_prefix[r][cur];
        if (cur > 0) {
            cut -= 2 * (cur - 1);
            if (r > 0) {
                cut -= 2 * cross_edges(rows[r - 1], cur);
            }
        }
    }

    cout << 2LL * cut << '\n';
    return 0;
}
