function legacyBuildName(version: string) {
  const [major, minor, patch] = version.split('.').map(Number);
  return major === 0 && (minor! < 2 || (minor === 2 && patch! < 34));
}

export function validateDesktopVersion(version: string, build: number) {
  if (!Number.isInteger(build) || build < 1 || build > 65535)
    throw new Error('desktopBuild 必须是 1 到 65535 的整数');
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('版本号必须为主版本.次版本.补丁版本，例如 0.2.34');
  if (legacyBuildName(version) && Number(version.split('.')[2]) !== build)
    throw new Error('旧版版本号末位必须与 desktopBuild 一致');
}

export function macArtifactBase(version: string, build: number, variant: string) {
  validateDesktopVersion(version, build);
  return `CourseWatch-${version}${legacyBuildName(version) ? `-build${build}` : ''}-mac-${variant}`;
}

export function windowsArtifactBase(version: string, build: number, revision = 0) {
  validateDesktopVersion(version, build);
  if (!Number.isInteger(revision) || revision < 0 || revision > 65535)
    throw new Error('windowsRevision 必须是 0 到 65535 的整数');
  if (!legacyBuildName(version) && revision !== 0)
    throw new Error('新版本修订应递增补丁版本，不再追加 windowsRevision');
  return `CourseWatch-${version}${legacyBuildName(version) ? `-build${build}` : ''}-win-x64${revision ? `-r${revision}` : ''}`;
}
