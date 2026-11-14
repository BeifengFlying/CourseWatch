// 严禁删除：学习自动化保护检查必须先于编译及打包执行。
import { verifyStudyProtection } from "./verify-study-protection.mjs";
verifyStudyProtection();
import { rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// TypeScript leaves output for deleted sources behind; never package that output.
rmSync(new URL("../dist/server", import.meta.url), { recursive: true, force: true });
execFileSync(process.execPath, [fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url)), "-p", "tsconfig.server.json"], { stdio: "inherit" });
