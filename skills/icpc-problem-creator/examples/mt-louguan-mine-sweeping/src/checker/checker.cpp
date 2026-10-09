#include "testlib.h"

int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);

    long long expected = ans.readLong();
    ans.skipBlanks();
    ans.readEof();

    long long actual = ouf.readLong();
    ouf.skipBlanks();
    ouf.readEof();

    if (expected != actual) {
        quitf(_wa, "expected %lld, found %lld", expected, actual);
    }

    quitf(_ok, "accepted");
}
