import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";

import { categoryDir } from "@/lib/paths";
import { allocateProblem, assertProblemReservation } from "./category";

const categories: string[] = [];

afterEach(async () => {
  await Promise.all(
    categories.splice(0).map((category) =>
      fs.rm(categoryDir(category), { recursive: true, force: true }),
    ),
  );
});

describe("concurrent problem allocation", () => {
  it("returns unique, contiguous, ownership-checked reservations", async () => {
    const category = `allocation-test-${process.pid}-${Date.now()}`;
    categories.push(category);
    const count = 24;
    const allocations = await Promise.all(
      Array.from({ length: count }, () => allocateProblem(category, "test")),
    );
    const ids = allocations.map((item) => item.problemId).sort();
    expect(new Set(ids).size).toBe(count);
    expect(ids).toEqual(
      Array.from(
        { length: count },
        (_, index) => `${category}/${category}-${String(index + 1).padStart(3, "0")}`,
      ),
    );
    await Promise.all(
      allocations.map((item) =>
        assertProblemReservation(item.problemId, item.reservationId),
      ),
    );
  });
});
