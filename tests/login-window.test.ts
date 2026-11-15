import { it, expect, vi } from 'vitest';
import { Adapters } from '../packages/adapters/src/index.js';

it.each(['redirect interrupted','navigation timeout'])('导航失败 %s 不关闭仍可使用的登录窗口', async (message) => {
  const page = { on:vi.fn(), frames:()=>[], goto: vi.fn().mockRejectedValue(new Error(message)), isClosed: () => false };
  const context = { pages: () => [page], on: vi.fn(), close: vi.fn() };
  const adapters = new Adapters('/tmp/unused-login-window');
  vi.spyOn(adapters as any, 'launch').mockResolvedValue(context);
  const result = await adapters.login('yuketang');
  expect(result.message).toContain('页面加载未完成');
  expect(adapters.activeLogin).toBe('yuketang');
  expect(context.close).not.toHaveBeenCalled();
  await adapters.cancel();
  expect(context.close).toHaveBeenCalledOnce();
});

it('用户已关闭的窗口不能被当作登录成功', async () => {
  const page = { on:vi.fn(), frames:()=>[], goto: vi.fn().mockRejectedValue(new Error('closed')), isClosed: () => true };
  const context = { pages: () => [page], on: vi.fn(), close: vi.fn() };
  const adapters = new Adapters('/tmp/unused-login-window');
  vi.spyOn(adapters as any, 'launch').mockResolvedValue(context);
  await expect(adapters.login('yuketang')).rejects.toThrow('无法打开登录窗口');
  expect(adapters.activeLogin).toBeNull();
});
