import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export type MacArch = "arm64" | "x64";
const nodeVersion = "24.22.1";

export async function macRuntime(arch: MacArch) {
  const localLicense = join(dirname(dirname(process.execPath)), "LICENSE");
  if (
    process.arch === arch &&
    process.version === `v${nodeVersion}` &&
    existsSync(localLicense)
  )
    return { executable: process.execPath, license: localLicense };

  const folder = `node-v${nodeVersion}-darwin-${arch}`;
  const file = `${folder}.tar.gz`;
  const cache = resolve(".cache/macos");
  await mkdir(cache, { recursive: true });
  const base = `https://nodejs.org/dist/v${nodeVersion}/`;
  // curl follows the host's proxy configuration, including environments where
  // Node's direct fetch cannot reach nodejs.org. HTTPS verification stays on.
  const download = async (name: string) =>
    execFileSync(
      "curl",
      [
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--connect-timeout",
        "20",
        "--max-time",
        "180",
        "--retry",
        "2",
        base + name,
      ],
      { maxBuffer: 150 * 1024 * 1024 },
    );
  const checksums = (await download("SHASUMS256.txt")).toString();
  const expected = checksums
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find((row) => row[1] === file)?.[0];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected))
    throw new Error(`Node.js 官方清单没有 ${file}`);
  const archive = join(cache, file);
  let bytes = existsSync(archive) ? await readFile(archive) : undefined;
  if (!bytes || createHash("sha256").update(bytes).digest("hex") !== expected)
    bytes = await download(file);
  if (createHash("sha256").update(bytes).digest("hex") !== expected)
    throw new Error("Node.js SHA256 校验失败");
  await writeFile(archive, bytes);
  await rm(join(cache, folder), { recursive: true, force: true });
  execFileSync("tar", ["-xzf", archive, "-C", cache]);
  return {
    executable: join(cache, folder, "bin/node"),
    license: join(cache, folder, "LICENSE"),
  };
}
