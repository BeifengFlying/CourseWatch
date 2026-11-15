import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";

// Keep documentation and licenses local; load demonstration images from the version tag.
export async function copyDistributionDocs(root: string, destination: string) {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const imageBase = `https://raw.githubusercontent.com/BeifengFlying/CourseWatch/v${pkg.version}/`;
  const files = [
    "LICENSE",
    "licenses/Apache-2.0.txt",
    "licenses/CourseWatch-Noncommercial-1.0.txt",
    "docs/verification/RELEASE-0.2.35.md",
    "CONTRIBUTING.md",
    "docs/legal/AUTOMATION_BOUNDARIES.md",
    "docs/guides/STUDY_PROTECTED_LOGIC.md",
    "docs/verification/AUTOMATION-NOTICE-2026-11-15.md",
    "docs/verification/APP-UPDATES-2026-11-15.md",
    "TERMS.md",
    "TERMS.en.md",
    "NOTICE",
    "README.md",
    "README.en.md",
    "docs/guides/BUILD_HISTORY.md",
    "docs/verification/RELEASE-0.2.30.md",
    "docs/verification/RELEASE-0.2.32.md",
    "docs/verification/RELEASE-0.2.33.md",
    "docs/verification/RELEASE-0.2.34.md",
    "docs/planning/RELEASE-0.2.34.md",
    "docs/verification/REPACK-0.2.33.md",
    "docs/verification/README-DESKTOP-2026-11-15.md",
    "docs/verification/WINDOWS-0.2.31-MERGE.md",
    "docs/verification/WINDOWS-0.2.34.md",
    "docs/verification/WINDOWS-0.2.35.md",
    "docs/verification/WINDOWS-0.2.30-R2.md",
    "docs/verification/STUDY-WEB-SEARCH-2026-11-15.md",
    "docs/verification/MACOS-PERFORMANCE-2026-11-14.md",
    "docs/verification/macos-performance-2026-11-14.json",
    "docs/verification/macos-power-2026-11-14.json",
    "CHANGELOG.md",
    "third_party/README.md",
    "third_party/UPSTREAM-MANIFEST.json",
    "third_party/xuexitong-llm-assistant/LICENSE",
    "third_party/chaoxing-ai-assistant/LICENSE",
    "docs/verification/STUDY-TASKS-MODEL-2026-11-14.md",
    "docs/verification/STUDY-READING-2026-11-14.md",
    "docs/verification/STUDY-SUBMIT-RESULT-2026-11-14.md",
    "docs/verification/UNIPUS-BACKGROUND-2026-11-14.md",
    "docs/verification/LEARNING-CONSOLE-2026-11-13.md",
    "docs/verification/PLATFORM-REMOVAL-2026-11-13.md",
    "docs/verification/UNIPUS-STUDY-2026-11-13.md",
    "docs/verification/STUDY-COURSE-UI-2026-11-13.md",
    "docs/research/UNIPUS-STUDY-2026-11-13.md",
    "docs/verification/COURSE-PLATFORMS-2026-11-13.md",
    "docs/verification/COURSES-STUDY-LOCAL-2026-11-13.md",
    "docs/verification/STUDY-EXPERIMENT-2026-11-13.md",
    "docs/research/CHAOXING-ASSISTANTS-FEASIBILITY-2026-11-13.md",
    "docs/verification/LOCAL-UPDATE-2026-11-13.md",
    "DISCLAIMER.md",
    "PRIVACY.md",
    "THIRD_PARTY_NOTICES.md",
    "docs/legal/RELEASE_LICENSE_REVIEW.md",
    "docs/verification/VERIFICATION-BUILD6.md",
    "docs/verification/VERIFICATION-BUILD7.md",
    "docs/verification/VERIFICATION-BUILD8.md",
    "docs/verification/SECURITY-FIX-2026-11-12.md",
    "docs/verification/VALIDATION-0.2.0.md",
    "docs/verification/VALIDATION-0.1.1.md",
    "docs/verification/VALIDATION.md",
    "docs/verification/VERIFICATION-2026-11-12.md",
    "docs/verification/EXPERIMENT-0.1.1.md",
    "docs/planning/PRD.md",
    "docs/planning/INTEGRATION_PLAN.md",
    "docs/planning/CROSS_PLATFORM.md",
    "docs/planning/FEASIBILITY.md",
    "docs/planning/OPEN_SOURCE.md",
    "docs/guides/WINDOWS.md",
    "docs/guides/WRITING_GUIDELINES.md",
    "docs/guides/INTERFACE_DESIGN.md",
    "docs/guides/MOBILE_NOTIFICATIONS.md",
    "docs/verification/MOBILE-NOTIFICATIONS-2026-11-13.md",
    "docs/verification/VERIFICATION-WINDOWS.md",
    "docs/planning/RESOURCE_BUDGET.md",
    "docs/guides/RESOURCE_USAGE.md",
    "docs/README.md",
    "docs/research/README.md",
    "docs/research/platform-evidence.md",
    "docs/research/sources.json",
    "scripts/README.md",
    "apps/extension/public/platforms/README.md",
  ];
  for (const file of files) {
    const target = join(destination, file);
    await mkdir(dirname(target), { recursive: true });
    if (file.endsWith(".md")) {
      const text = await readFile(join(root, file), "utf8");
      // Cover Markdown links/images and HTML src/href attributes. Resolve with
      // POSIX paths so Windows produces the same repository URLs as macOS.
      const onlineImages = text.replace(
        /(\]\(\s*<?|(?:src|href)=["'])([^)\s"'<>]+)/g,
        (match, prefix: string, url: string) => {
          if (/^(?:[a-z][a-z0-9+.-]*:|[/#])/i.test(url)) return match;
          const path = posix.normalize(posix.join(posix.dirname(file), url));
          return /^docs\/(?:screenshots|images)\//.test(path)
            ? prefix + imageBase + path
            : match;
        },
      );
      await writeFile(target, onlineImages);
    } else {
      await cp(join(root, file), target);
    }
  }
  await cp(
    join(root, "apps/extension/public/platforms/README.md"),
    join(destination, "PLATFORM_ASSET_SOURCES.md"),
  );
}

// Conservative installed dependency closure, not a bundle-module inventory.
// Do not fabricate missing copyright notices from package metadata.
export async function copyUiLicenses(root: string, destination: string) {
  const seen = new Set<string>();
  const index: string[] = [];
  const missing: string[] = [];
  const output = join(destination, "UI-LICENSES");
  await mkdir(output, { recursive: true });
  function locate(name: string, from: string): string {
    let current = from;
    while (true) {
      const path = join(current, "node_modules", name);
      if (existsSync(join(path, "package.json"))) return path;
      const next = dirname(current);
      if (next === current) throw new Error(`找不到界面依赖 ${name}`);
      current = next;
    }
  }
  async function collect(name: string, from: string) {
    const source = locate(name, from);
    if (seen.has(source)) return;
    seen.add(source);
    const meta = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    // Preserve installation path to distinguish nested versions of one package.
    const path = relative(root, source);
    const target = join(output, path);
    const files = (await readdir(source)).filter((file) =>
      /^(licen[sc]e|copying|notice|copyright|third[-_ ]?party)/i.test(file),
    );
    await mkdir(target, { recursive: true });
    for (const file of files)
      await cp(join(source, file), join(target, file), { recursive: true });
    const hasLicense = files.some((file) => /^(licen[sc]e|copying)/i.test(file));
    const entry = `${meta.name}@${meta.version} | ${JSON.stringify(meta.license ?? "unknown")} | ${path} | ${files.join(", ") || "未发现根目录许可文件"}`;
    index.push(entry);
    if (!hasLicense) missing.push(`${meta.name}@${meta.version}`);
    for (const dep of Object.keys(meta.dependencies ?? {}))
      await collect(dep, source);
  }
  for (const name of ["vue", "naive-ui", "lucide-vue-next"])
    await collect(name, root);
  await writeFile(
    join(output, "INDEX.txt"),
    "已安装界面依赖树；可能包含未进入最终产物的模块。\n" +
      "根目录匹配不构成完整二进制或嵌套素材许可审计。\n\n" +
      index.sort().join("\n") +
      "\n\n缺少原始许可文本，分发前需要核对：\n" +
      (missing.sort().join("\n") || "本次扫描未发现") +
      "\n",
  );
  return { packages: seen.size, missing };
}
