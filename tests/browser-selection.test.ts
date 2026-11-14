import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
vi.mock('node:child_process', async original => ({
  ...await original<typeof import('node:child_process')>(),
  fork: vi.fn(() => {
    const child = new EventEmitter() as any;
    child.connected = true; child.exitCode = null; child.signalCode = null;
    child.send = (message: any, done?: Function) => {
      done?.(); queueMicrotask(() => child.emit('message', { id: message.id, result: { items: [], issues: [] } }));
    };
    child.disconnect = () => { child.connected = false; child.exitCode = 0; queueMicrotask(() => child.emit('exit', 0)); };
    child.kill = child.disconnect;
    return child;
  }),
}));
import { fork } from 'node:child_process';
import { AdapterManager } from '../packages/adapters/src/manager.js';
import { CourseCatalogManager } from '../packages/study/src/catalog-manager.js';
it('登录、采集及目录子进程使用保存的浏览器选择，后续窗口读取新选择', async () => {
  let selected = 'edge'; const selection = () => selected;
  const adapters = new AdapterManager('/fixture', selection);
  await adapters.login('chaoxing');
  expect(vi.mocked(fork).mock.calls.at(-1)?.[2]?.env?.COURSEWATCH_BROWSER).toBe('edge');
  await adapters.cancel(); selected = 'chrome';
  await adapters.scan({ id: 'chaoxing', sources: [] } as any);
  expect(vi.mocked(fork).mock.calls.at(-1)?.[2]?.env?.COURSEWATCH_BROWSER).toBe('chrome');
  const catalog = new CourseCatalogManager(undefined, selection);
  await catalog.read('/fixture', 'chaoxing', []);
  expect(vi.mocked(fork).mock.calls.at(-1)?.[2]?.env?.COURSEWATCH_BROWSER).toBe('chrome');
});
