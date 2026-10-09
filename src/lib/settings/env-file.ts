import path from "node:path";

/**
 * The .env.local anchor.
 *
 * The settings API reads and writes this file so the console can manage the
 * LLM configuration without asking the user to edit files by hand. It lives
 * next to paths.ts but stays separate because it is a write target, not a
 * read anchor: nothing else in the app should ever write here.
 */

export const repoRoot = process.cwd();

export function envLocalPath(): string {
  return path.join(repoRoot, ".env.local");
}
