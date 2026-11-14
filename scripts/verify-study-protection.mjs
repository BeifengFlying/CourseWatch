// 严禁删除：用户要求对视频弹题穷举及 U校园 5 分钟保活加入删除、篡改和入口脱落检查。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const root = new URL('../', import.meta.url);
export function verifyStudyProtection(read = path => readFileSync(new URL(path, root), 'utf8')) {
  const manifest = JSON.parse(read('packages/study/study-protection.json'));
  if (manifest.version !== 1 || !manifest.files || !Array.isArray(manifest.wiring)) throw new Error('学习逻辑保护清单无效');
  for (const [path, hash] of Object.entries(manifest.files)) {
    let source;
    try { source = read(path); } catch { throw new Error(`严禁删除的学习模块或测试缺失：${path}`); }
    if (createHash('sha256').update(source).digest('hex') !== hash) throw new Error(`受保护学习逻辑发生变化：${path}；请核对行为并同步保护清单，禁止跳过检查`);
  }
  for (const { file, required } of manifest.wiring) {
    const source = read(file);
    for (const snippet of required) if (!source.includes(snippet)) throw new Error(`受保护学习入口缺失：${file} → ${snippet}`);
  }
  return { protectedFiles: Object.keys(manifest.files).length, entryPoints: manifest.wiring.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(verifyStudyProtection()));
