import { promises as fs } from "node:fs";
import path from "node:path";

import { icpcSkillDir, problemDir } from "@/lib/paths";
import { runSandbox, withSandboxScratch } from "@/lib/sandbox/docker";

/**
 * Hydro zip export, sandboxed.
 *
 * The skill's export-hydrozip.ps1 packages a verified workspace into the
 * Hydro OJ's problem format. It writes intermediate artefacts into the
 * workspace itself (exported-tests/) and the skill root
 * (.codex-test-artifacts/), both of which are read-only pipeline
 * artefacts - and Docker cannot nest a writable mount inside a read-only
 * one. So the workspace is COPIED into the scratch first, and the copy is
 * mounted writable. The skill root still needs its artefacts dir, which
 * gets a scratch mount (the skill root itself stays read-only; the mount
 * point is created by the image's directory layout... it is not, so the
 * artefacts dir is pre-created inside the copied workspace and the skill
 * mount is replaced by a copy too when needed).
 *
 * Simplest correct layout: copy BOTH the workspace and the skill's
 * scripts into the scratch, run against the copies, copy the zip out.
 */

export type HydroExportResult = {
  ok: boolean;
  /** Host path of the produced zip, null on failure. */
  zipPath: string | null;
  /** The script's stdout/stderr tail, for diagnostics. */
  log: string;
};

/**
 * Export one problem to a Hydro zip.
 *
 * @param problemId  e.g. "graph/graph-006"
 * @param outputDir  host directory for the zip (created when missing)
 */
export async function exportHydroZip(
  problemId: string,
  outputDir: string,
): Promise<HydroExportResult> {
  const parts = problemId.split("/");
  if (parts.length !== 2) {
    throw new Error(`题目 id 应为 <分类>/<目录> 两级: ${problemId}`);
  }

  const script = path.join(icpcSkillDir, "scripts", "export-hydrozip.ps1");
  if (!(await fs.stat(script).then(() => true, () => false))) {
    throw new Error(`导出脚本不存在: ${script}`);
  }

  await fs.mkdir(outputDir, { recursive: true });

  return withSandboxScratch(async (scratch) => {
    await fs.chmod(scratch, 0o777).catch(() => {});

    // Copy the workspace into the scratch: the export script writes
    // exported-tests/ inside it, and the source workspace must stay
    // untouched.
    const workspaceCopy = path.join(scratch, "problem");
    await fs.cp(problemDir(problemId), workspaceCopy, { recursive: true });
    await fs.chmod(workspaceCopy, 0o777).catch(() => {});

    // The skill root is mounted read-only except for its artefacts dir.
    // The script writes compiled binaries under
    // <skill>/.codex-test-artifacts/, so give that subtree a writable
    // scratch mount. Docker cannot nest mounts, so the skill is copied
    // too - but only the scripts and include dirs (the artefacts and
    // examples trees are large and unneeded).
    const skillCopy = path.join(scratch, "skill");
    await fs.mkdir(skillCopy, { recursive: true });
    for (const sub of ["scripts", "include"]) {
      const src = path.join(icpcSkillDir, sub);
      if (await fs.stat(src).then(() => true, () => false)) {
        await fs.cp(src, path.join(skillCopy, sub), { recursive: true });
      }
    }
    await fs.chmod(skillCopy, 0o777).catch(() => {});

    const result = await runSandbox({
      command: "pwsh",
      args: [
        "-NoProfile",
        "-File",
        "/skill/scripts/export-hydrozip.ps1",
        "-Workspace",
        "/problem",
        "-Output",
        "/out/problem.zip",
      ],
      mounts: [
        { hostPath: skillCopy, containerPath: "/skill" },
        { hostPath: workspaceCopy, containerPath: "/problem" },
        { hostPath: scratch, containerPath: "/out" },
      ],
      timeoutMs: 300_000,
      memoryMb: 2048,
      cpus: 2,
      pidsLimit: 128,
      maxOutputBytes: 16 * 1024 * 1024,
      tmpfsMb: 256,
    });

    const log = `${result.stdout}\n${result.stderr}`.trim().slice(-4000);
    const hostZip = path.join(scratch, "problem.zip");
    if (result.code !== 0 || !(await fs.stat(hostZip).then(() => true, () => false))) {
      return { ok: false, zipPath: null, log };
    }

    // Copy the zip out of the scratch before it is deleted.
    const destination = path.join(outputDir, `${parts[1]}.hydro.zip`);
    await fs.copyFile(hostZip, destination);
    return { ok: true, zipPath: destination, log };
  });
}
