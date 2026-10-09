#include "testlib.h"
#include <bits/stdc++.h>

using namespace std;

int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1);
    if (argc != 3) {
        cerr << "Usage: generator <type> <seed>\n";
        return 1;
    }

    string type = argv[1];
    long long seed = atoll(argv[2]);
    rnd.setSeed(seed);

    int n = 1;
    int k = 0;

    if (type == "sample") {
        n = 4;
        k = 2;
    } else if (type == "zero") {
        n = rnd.next(1, 50);
        k = 0;
    } else if (type == "full") {
        n = rnd.next(1, 50);
        k = n;
    } else if (type == "tiny-hack") {
        n = 3;
        k = 2;
    } else if (type == "square-hack") {
        n = 4;
        k = 2;
    } else if (type == "near-full-small") {
        n = rnd.next(5, 10);
        k = n - 1;
    } else if (type == "random-small") {
        n = rnd.next(1, 12);
        k = rnd.next(0, n);
    } else if (type == "random-medium") {
        n = rnd.next(13, 30);
        k = rnd.next(0, n);
    } else if (type == "random-large") {
        n = rnd.next(31, 50);
        k = rnd.next(0, n);
    } else if (type == "balanced-large") {
        n = rnd.next(20, 50);
        int low = max(0, n / 2 - 3);
        int high = min(n, n / 2 + 3);
        k = rnd.next(low, high);
    } else if (type == "near-full-large") {
        n = rnd.next(20, 50);
        k = rnd.next(max(0, n - 4), n);
    } else if (type == "low-k-large") {
        n = rnd.next(30, 50);
        k = rnd.next(0, min(5, n));
    } else {
        cerr << "Unknown case type: " << type << '\n';
        return 2;
    }

    cout << n << ' ' << k << '\n';
    return 0;
}
