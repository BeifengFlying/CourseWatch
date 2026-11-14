import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
const exec = promisify(execFile);
// The encryption key lives in Keychain; on Windows the payload is protected by current-user DPAPI.
export class Vault {
  private key?: Buffer;
  constructor(private dir: string) {}
  private async macKey() {
    if (this.key) return this.key;
    const account = createHash("sha256")
      .update(this.dir)
      .digest("hex")
      .slice(0, 24);
    let encoded: string;
    try {
      encoded = (
        await exec("/usr/bin/security", [
          "find-generic-password",
          "-s",
          "CourseWatch.session-key",
          "-a",
          account,
          "-w",
        ])
      ).stdout.trim();
    } catch {
      encoded = randomBytes(32).toString("base64");
      await exec("/usr/bin/security", [
        "add-generic-password",
        "-s",
        "CourseWatch.session-key",
        "-a",
        account,
        "-w",
        encoded,
      ]);
    }
    this.key = Buffer.from(encoded, "base64");
    return this.key;
  }
  private async dpapi(value: string, decrypt = false) {
    const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${decrypt ? "Unprotect" : "Protect"}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`;
    return new Promise<string>((resolve, reject) => {
      const child = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ],
        { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] },
      );
      let output = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("系统凭据操作超时"));
      }, 15000);
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.length > 4 * 1024 * 1024) {
          child.kill();
          reject(new Error("会话超过安全大小上限"));
        }
      });
      child.on("error", () => {
        clearTimeout(timer);
        reject(new Error("无法调用系统凭据能力"));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        code === 0
          ? resolve(output.trim())
          : reject(new Error("系统凭据操作未完成"));
      });
      child.stdin.on("error", () => {});
      child.stdin.end(value);
    });
  }
  async save(id: string, value: unknown) {
    const raw = Buffer.from(JSON.stringify(value));
    let result: string;
    if (process.platform === "darwin") {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", await this.macKey(), iv);
      const payload = Buffer.concat([cipher.update(raw), cipher.final()]);
      result = JSON.stringify({
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: payload.toString("base64"),
      });
    } else if (process.platform === "win32")
      result = await this.dpapi(raw.toString("base64"));
    else throw new Error("当前系统未实现安全会话存储");
    const target = join(this.dir, `${id}.encrypted`), temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, result, { mode: 0o600 });
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(() => {}); }
  }
  async read(id: string) {
    let stored: string;
    try {
      stored = await readFile(join(this.dir, `${id}.encrypted`), "utf8");
    } catch {
      return undefined;
    }
    try {
      if (process.platform === "darwin") {
        const v = JSON.parse(stored);
        const dec = createDecipheriv(
          "aes-256-gcm",
          await this.macKey(),
          Buffer.from(v.iv, "base64"),
        );
        dec.setAuthTag(Buffer.from(v.tag, "base64"));
        return JSON.parse(
          Buffer.concat([
            dec.update(Buffer.from(v.data, "base64")),
            dec.final(),
          ]).toString(),
        );
      }
      if (process.platform === "win32")
        return JSON.parse(
          Buffer.from(await this.dpapi(stored, true), "base64").toString(),
        );
    } catch {
      throw new Error("无法解密本机会话，请重新登录");
    }
  }
}
