from functools import lru_cache


def cross_edges(upper: int, lower: int) -> int:
    if lower == 0:
        return 0
    if upper == lower:
        return 3 * lower - 2
    return 3 * lower - 1


def main() -> None:
    n, k = map(int, input().split())
    mines = k * k

    degree_prefix = [[0] * (n + 1) for _ in range(n)]
    for r in range(n):
        for c in range(n):
            deg = 0
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    if dr == 0 and dc == 0:
                        continue
                    nr = r + dr
                    nc = c + dc
                    if 0 <= nr < n and 0 <= nc < n:
                        deg += 1
            degree_prefix[r][c + 1] = degree_prefix[r][c] + deg

    @lru_cache(maxsize=None)
    def solve(row: int, used: int, prev: int) -> int:
        if used > mines:
            return 10**9
        if row == n:
            return 0 if used == mines else 10**9

        limit = min(prev, mines - used)
        best = 10**9
        for cur in range(limit + 1):
            add = degree_prefix[row][cur]
            if cur > 0:
                add -= 2 * (cur - 1)
                if row > 0:
                    add -= 2 * cross_edges(prev, cur)
            best = min(best, add + solve(row + 1, used + cur, cur))
        return best

    print(2 * solve(0, 0, n))


if __name__ == "__main__":
    main()
