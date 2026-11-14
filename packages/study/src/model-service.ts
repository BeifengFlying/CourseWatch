import { ModelEndpoint } from '../../contracts/src/study.js';

export function modelHTTPError(status: number) {
  return status === 400 ? '模型请求被拒绝（HTTP 400），请检查模型名称及接口参数'
    : status === 401 || status === 403 ? '模型 Key 无效或没有访问权限，请检查 Key 和服务商'
    : status === 404 ? '模型接口或模型名称不存在，请检查 API 地址及模型名称（部分服务需要 /v1）'
    : status === 429 ? '模型服务限流或余额不足，请到服务商检查额度后重试'
    : `模型服务请求失败（HTTP ${status}）`;
}
export async function readModelJSON(response: Response): Promise<any> {
  if (!response.ok) { await response.body?.cancel(); throw new Error(modelHTTPError(response.status)); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('模型服务未返回内容');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      length += item.value.byteLength;
      if (length > 2 * 1024 * 1024) throw new Error('模型响应超过大小上限');
      chunks.push(item.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new Error('模型接口没有返回 JSON，请检查是否填成了服务商网页地址'); }
}
export async function inspectModelService(base: string, key: string, model?: string, request = fetch) {
  const baseURL = ModelEndpoint.parse(base);
  let response: Response;
  try {
    response = await request(`${baseURL}/${model ? 'chat/completions' : 'models'}`, {
      method: model ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${key}`, ...(model ? { 'Content-Type': 'application/json' } : {}) },
      ...(model ? { body: JSON.stringify({model, stream:false, max_tokens:32, messages:[{role:'user',content:'Reply OK.'}]}) } : {}),
    });
  } catch { throw new Error('无法连接模型服务，请检查 API 地址、网络或代理'); }
  const data = await readModelJSON(response);
  if (data?.error) throw new Error('模型服务返回错误，请检查模型权限、名称及余额');
  if (model) {
    if (!data?.choices?.[0]?.message || typeof data.choices[0].message.content !== 'string') throw new Error('接口未返回 Chat Completions 答复，请检查接口类型');
    return { model, message: '模型连接成功' };
  }
  if (!Array.isArray(data?.data)) throw new Error('接口未返回模型列表，可手动填写模型名称并测试连接');
  const models = [...new Set<string>(data.data.flatMap((item: any) => typeof item?.id === 'string' && item.id.trim() && item.id.length <= 200 ? [item.id.trim()] : []))].sort();
  if (!models.length) throw new Error('服务商返回空模型列表，可手动填写模型名称并测试连接');
  return { models };
}
