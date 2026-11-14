import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, join } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(process.argv[2] || 'third_party');
const manifest = JSON.parse(await readFile(join(root, 'UPSTREAM-MANIFEST.json'), 'utf8'));
async function list(path) { const entries = await readdir(path, {withFileTypes:true}); const values=[]; for (const entry of entries) { const file=join(path,entry.name); assert.ok(!entry.isSymbolicLink(), `unexpected symlink ${file}`); if(entry.isDirectory())values.push(...await list(file));else values.push(file); } return values; }
let count = 0;
for (const entry of manifest) {
  const path = join(root,entry.directory);
  const actual = (await list(path)).map(file=>relative(path,file).replaceAll('\\','/')).sort();
  assert.deepEqual(actual,Object.keys(entry.files).sort(),`${entry.directory}: 文件集合发生变化`);
  for (const [file,hash] of Object.entries(entry.files)) {
    assert.equal(createHash('sha256').update(await readFile(join(path,file))).digest('hex'),hash,`${entry.directory}/${file}: 上游原文件被修改`); count++;
  }
  assert.ok((await stat(join(path,'LICENSE'))).size > 0);
  console.log(`${entry.directory} @ ${entry.commit}: ${actual.length} 个原文件校验通过`);
}
console.log(`共 ${count} 个原文件；原版权和 LICENSE 已保留。`);
