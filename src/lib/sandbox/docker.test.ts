import { describe, expect, it, vi } from "vitest";

describe("sandbox fail-closed policy", () => {
  it("rejects execution when Docker is unavailable", async () => {
    vi.stubEnv("DOCKER_CLI", "definitely-not-a-docker-binary");
    vi.resetModules();
    const { requireSandbox } = await import("./docker");
    await expect(requireSandbox()).rejects.toThrow(
      "已拒绝在宿主机执行不可信代码",
    );
    vi.unstubAllEnvs();
  });
});
