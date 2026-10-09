#include <bits/stdc++.h>

using namespace std;

namespace {

long long evaluate_cut(int n, int width, int mines) {
    vector<string> board(n, string(n, '.'));
    int left = mines;
    for (int r = 0; r < n && left > 0; ++r) {
        int take = min(width, left);
        for (int c = 0; c < take; ++c) {
            board[r][c] = '#';
        }
        left -= take;
    }
    if (left > 0) {
        return (long long)4e18;
    }

    long long cut = 0;
    static const int dr[8] = {-1, -1, -1, 0, 0, 1, 1, 1};
    static const int dc[8] = {-1, 0, 1, -1, 1, -1, 0, 1};
    for (int r = 0; r < n; ++r) {
        for (int c = 0; c < n; ++c) {
            for (int d = 0; d < 8; ++d) {
                int nr = r + dr[d];
                int nc = c + dc[d];
                if (nr < 0 || nr >= n || nc < 0 || nc >= n) {
                    continue;
                }
                if (board[r][c] != board[nr][nc]) {
                    ++cut;
                }
            }
        }
    }
    return cut / 2;
}

}  // namespace

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n = 0;
    int k = 0;
    cin >> n >> k;
    int mines = k * k;

    if (k == 0 || k == n) {
        cout << 0 << '\n';
        return 0;
    }

    long long best = (long long)4e18;
    for (int width = 1; width <= n; ++width) {
        if ((mines + width - 1) / width > n) {
            continue;
        }
        best = min(best, evaluate_cut(n, width, mines));
    }

    cout << best * 2 << '\n';
    return 0;
}
