import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadIndexEntries } from '../../../src/index/build/tree-sitter-scheduler/runner/index-loader.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
const root=resolveTestCachePath(process.cwd(),`scheduler-duplicates-${crypto.randomUUID()}`);
const paths={resultsIndexPathForGrammarKey:key=>path.join(root,`${key}.vfsidx`)};
const row=(grammarKey,offset)=>({grammarKey,virtualPath:'same/path.js',offset,bytes:20});
const write=(key,rows)=>fs.writeFile(paths.resultsIndexPathForGrammarKey(key),rows.map(value=>JSON.stringify(value)).join('\n'));
try {
  await fs.mkdir(root,{recursive:true});
  await write('a',[row('a',0),row('a',20)]);
  await assert.rejects(loadIndexEntries({grammarKeys:['a'],paths}),error=>error.code==='ERR_TREE_SITTER_INDEX_DUPLICATE'&&error.message.includes('a.vfsidx'));
  await write('a',[row('a',0)]);await write('b',[row('b',20)]);
  await assert.rejects(loadIndexEntries({grammarKeys:['a','b'],paths}),error=>error.code==='ERR_TREE_SITTER_INDEX_DUPLICATE'&&error.message.includes('a.vfsidx')&&error.message.includes('b.vfsidx'));
  await write('b',[{...row('b',20),virtualPath:'other/path.js'}]);
  assert.equal((await loadIndexEntries({grammarKeys:['a','b'],paths})).size,2);
} finally {await fs.rm(root,{recursive:true,force:true});}
console.log('scheduler duplicate path rejection passed');
