import { readModelJSON, modelHTTPError } from './model-service.js';
export interface ModelOutput { reasoning: string; answer: string; }
export type ModelProgress = (output: ModelOutput) => void;

// Only display text explicitly returned by the provider. Do not manufacture
// hidden reasoning. A failed stream is never retried as another paid request.
export async function readModelStream(response: Response, progress: ModelProgress, signal: AbortSignal): Promise<any> {
  if (!response.ok) { await response.body?.cancel(); throw new Error(modelHTTPError(response.status)); }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = await readModelJSON(response), message = data.choices?.[0]?.message;
    progress({reasoning:typeof message?.reasoning_content === 'string' ? message.reasoning_content : '',answer:typeof message?.content === 'string' ? message.content : ''});
    return data;
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('模型服务未返回内容');
  const decoder = new TextDecoder();
  let buffer = '', length = 0, reasoning = '', content = '', finish: string | null = null, usage: unknown;
  let lastSend = 0;
  const emit = (force = false) => { if (force || Date.now() - lastSend >= 100) { progress({reasoning:reasoning.slice(-24000),answer:content.slice(-24000)});lastSend = Date.now(); } };
  const event = (block: string) => {
    const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let payload: any; try { payload = JSON.parse(data); } catch { throw new Error('模型流式响应格式无法识别，未填入或提交'); }
    if (payload.error) throw new Error('模型流式请求返回错误，未填入或提交');
    if (payload.usage) usage = payload.usage;
    const choice = payload.choices?.find((c: any) => c.index === 0) || payload.choices?.[0];
    const delta = choice?.delta;
    if (typeof delta?.reasoning_content === 'string') reasoning += delta.reasoning_content;
    else if (typeof delta?.reasoning === 'string') reasoning += delta.reasoning;
    if (typeof delta?.content === 'string') content += delta.content;
    if (choice?.finish_reason) finish = choice.finish_reason;
    emit();
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 2 * 1024 * 1024) throw new Error('模型响应超过大小上限');
      buffer += decoder.decode(chunk.value, {stream:true});
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) { event(buffer.slice(0,boundary)); buffer = buffer.slice(boundary + 2); }
    }
    buffer += decoder.decode(); if (buffer.trim()) event(buffer);
    if (!finish) throw new Error('模型流式连接提前结束，未填入或提交');
    emit(true);
    return {choices:[{message:{content},finish_reason:finish}],usage};
  } finally { await reader.cancel().catch(() => {}); }
}
