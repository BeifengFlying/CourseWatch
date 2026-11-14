const BASE =
  location.protocol === "http:" && location.hostname === "127.0.0.1"
    ? location.origin
    : "http://127.0.0.1:17321";
const key = "coursewatch-client-token";
export const auth = {
  get: () => localStorage.getItem(key) ?? "",
  set: (token: string) => localStorage.setItem(key, token),
  clear: () => localStorage.removeItem(key),
};
export async function api(path: string, method = "GET", body?: unknown, timeout = 45000) {
  let response: Response;
  try {
    response = await fetch(`${BASE}/api/${path}`, {
      method,
      signal: AbortSignal.timeout(timeout),
      headers: {
        ...(auth.get() ? { Authorization: `Bearer ${auth.get()}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if ((error as Error).name === "TimeoutError") throw new Error("本地后台响应超时，请稍后重试");
    throw new Error("无法连接本地后台，请运行 npm run background");
  }
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) auth.clear();
    throw new Error(data.error ?? "操作失败");
  }
  return data;
}
