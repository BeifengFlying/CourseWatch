export const UPDATE_REPOSITORY = 'BeifengFlying/CourseWatch';
export const UPDATE_API_URL = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases?per_page=20`;
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export interface AppRelease {
  version: string;
  url: string;
  notes: string;
  prerelease: boolean;
}
export interface AppUpdateStatus {
  currentVersion: string;
  automatic: boolean;
  state: 'idle' | 'checking' | 'current' | 'available' | 'error';
  checkedAt: number | null;
  latest: AppRelease | null;
  error: string | null;
}
export function versionParts(version: string): number[] | null {
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)) return null;
  const parts = version.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = versionParts(candidate), b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function releasePage(version: string): string {
  if (!versionParts(version)) throw new Error('版本格式无效');
  return `https://github.com/${UPDATE_REPOSITORY}/releases/tag/v${version}`;
}
export function safeReleasePage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === 'https://github.com' && !url.username && !url.password && !url.search && !url.hash
      && new RegExp(`^/${UPDATE_REPOSITORY}/releases/tag/v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-desktop)?$`).test(url.pathname);
  } catch { return false; }
}
