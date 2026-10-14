import { describe, expect, it, vi } from "vitest";

import { isSandboxUnavailableError } from "./docker";

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

describe("isSandboxUnavailableError", () => {
  it("recognises the sandbox being down", () => {
    expect(
      isSandboxUnavailableError(
        "Error response from daemon: Docker Desktop is unable to start",
      ),
    ).toBe(true);
    expect(
      isSandboxUnavailableError(
        "Cannot connect to the Docker daemon at npipe:////./pipe/docker_engine. Is the docker daemon running?",
      ),
    ).toBe(true);
    expect(isSandboxUnavailableError("error during connect: this error may indicate that the docker daemon is not running")).toBe(true);
    expect(
      isSandboxUnavailableError(
        "安全沙箱不可用，已拒绝在宿主机执行不可信代码。请先启动 Docker，并运行 npm run sandbox:build",
      ),
    ).toBe(true);
  });

  it("does not mistake a real problem failure for infrastructure", () => {
    expect(isSandboxUnavailableError("FAIL edge 4: expected u_i < v_i, got 4 1")).toBe(false);
    expect(
      isSandboxUnavailableError(
        "[verifier-crash] 验题脚本未跑完就异常退出（exit=1），末尾错误：未知错误",
      ),
    ).toBe(false);
    expect(isSandboxUnavailableError("[generate] generator 失败：case=boundary-min")).toBe(false);
    expect(isSandboxUnavailableError("")).toBe(false);
  });
});
