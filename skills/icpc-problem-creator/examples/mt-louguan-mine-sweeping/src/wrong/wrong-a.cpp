#include <bits/stdc++.h>

using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    long long n = 0;
    long long k = 0;
    cin >> n >> k;

    if (k == 0 || k == n) {
        cout << 0 << '\n';
    } else {
        cout << 12LL * k - 6 << '\n';
    }
    return 0;
}
