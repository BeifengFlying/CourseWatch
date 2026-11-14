import { readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';
import { expect, it } from 'vitest';
import { APP_VERSION, DESKTOP_BUILD } from '../packages/contracts/src/version.js';
import { validateDesktopVersion, windowsArtifactBase } from '../scripts/desktop-version.js';

it('版本末位、构建号、锁文件及原生平台元数据一致', () => {
  expect(() => validateDesktopVersion(APP_VERSION, DESKTOP_BUILD)).not.toThrow();
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  expect(lock.version).toBe(APP_VERSION);
  expect(lock.packages[''].version).toBe(APP_VERSION);
  const plist = readFileSync('apps/macos/Info.plist', 'utf8');
  expect(plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1]).toBe(APP_VERSION);
  expect(plist.match(/<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/)?.[1]).toBe(String(DESKTOP_BUILD));
  expect(readFileSync('apps/windows/CourseWatch.csproj', 'utf8')).toContain(`<Version>${APP_VERSION}</Version>`);
  expect(readFileSync('apps/windows/app.manifest', 'utf8')).toContain(`version="${APP_VERSION}.0"`);
});

it('Windows 修订包保留版本与构建号，文件名区分旧包', () => {
  expect(windowsArtifactBase('0.2.30', 30)).toBe('CourseWatch-0.2.30-build30-win-x64');
  expect(windowsArtifactBase('0.2.30', 30, 2)).toBe('CourseWatch-0.2.30-build30-win-x64-r2');
  for (const revision of [-1, 1.5, 65536, NaN])
    expect(() => windowsArtifactBase('0.2.30', 30, revision)).toThrow('windowsRevision');
});

it('Windows Actions 会上传原版与修订包的安装程序、ZIP 和校验文件', () => {
  const workflow = readFileSync('.github/workflows/windows.yml', 'utf8');
  const patterns = workflow.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith('dist/'));
  for (const revision of [0, 2]) {
    const base = windowsArtifactBase('0.2.30', 30, revision);
    for (const suffix of ['.zip', '-setup.exe', '.zip.sha256', '-setup.exe.sha256'])
      expect(patterns.some(pattern => matchesGlob(`dist/${base}${suffix}`, pattern))).toBe(true);
  }
});

it('打包拒绝版本末位与构建号不符或非法构建号', () => {
  expect(() => validateDesktopVersion('0.2.0', 28)).toThrow('末位');
  for (const build of [0, 1.5, 65536, NaN]) expect(() => validateDesktopVersion('0.2.28', build)).toThrow('desktopBuild');
});
