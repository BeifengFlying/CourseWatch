export function validateDesktopVersion(version: string, build: number) {
  if (!Number.isInteger(build) || build < 1 || build > 65535)
    throw new Error('desktopBuild 必须是 1 到 65535 的整数');
  if (!/^\d+\.\d+\.\d+$/.test(version) || Number(version.split('.')[2]) !== build)
    throw new Error('版本号末位必须与 desktopBuild 一致，例如 0.2.28 对应构建 28');
}

export function windowsArtifactBase(version: string, build: number, revision = 0) {
  validateDesktopVersion(version, build);
  if (!Number.isInteger(revision) || revision < 0 || revision > 65535)
    throw new Error('windowsRevision 必须是 0 到 65535 的整数');
  return `CourseWatch-${version}-build${build}-win-x64${revision ? `-r${revision}` : ''}`;
}
