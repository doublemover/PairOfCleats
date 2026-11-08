import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLanguageImportEntries } from '../../../src/index/language-registry.js';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { normalizeImportSpecifier } from '../../../src/index/build/import-resolution/path-utils.js';
import { assertEscapedImportReplay } from './escaped-import-replay-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const source=['source ./lib#tag.sh','source "./lib#tag.sh"','source \'./lib#tag.sh\'',
  'source ./lib\\#tag.sh','source ./lib"#tag".sh later # comment','source "./lib?tag.sh"',
  'source "./lib util.sh" later','source ./lib\\ util.sh','source ./lib.sh # trailing comment',
  'source # true word-start comment','source "$dynamic"','source "$(command)"','source ./wild?.sh',''].join('\n');
const expected=['./lib#tag.sh','./lib?tag.sh','./lib util.sh','./lib.sh'].toSorted();
const entries=collectLanguageImportEntries({text:source,ext:'.sh',relPath:'scripts/main.sh',mode:'code'});
assert.deepEqual(entries.map(row=>row.specifier),expected);
const {root,abs,stat}=await assertEscapedImportReplay({name:'shell-literal-suffix-resolution',file:'scripts/main.sh',source,expected});
const files=[{rel:'scripts/main.sh',abs,stat}];
for(const rel of ['scripts/lib#tag.sh','scripts/lib util.sh','scripts/lib.sh']) {
  const target=path.join(root,rel);await fs.writeFile(target,'# passive fixture\n');files.push({rel,abs:target,stat:await fs.stat(target)});
}
// Windows cannot create '?'. This control qualifies the actual resolver against
// an explicit admitted inventory, and makes no physical-filename claim.
files.push({rel:'scripts/lib?tag.sh',abs:path.join(root,'scripts/lib?tag.sh')});
for(const decoy of [true,false]) {
  const imports=decoy?expected:expected.filter(x=>x!=='./lib.sh'),cache={};
  const run=()=>{
    const relations=new Map([['scripts/main.sh',{imports}]]);
    resolveImportLinks({root,entries:files.filter(row=>decoy||row.rel!=='scripts/lib.sh'),importsByFile:{'scripts/main.sh':imports},
      fileRelations:relations,enableGraph:true,cache,fileHashes:new Map([['scripts/main.sh','unchanged-source']])});
    return relations.get('scripts/main.sh').importLinks.toSorted();
  };
  const targets=imports.map(value=>'scripts/'+value.slice(2)).toSorted();assert.deepEqual(run(),targets);assert.deepEqual(run(),targets);
}
assert.equal(normalizeImportSpecifier('./lib#tag.sh',{fileLiteral:true}),'./lib#tag.sh');
assert.equal(normalizeImportSpecifier('./lib.js?raw#part'),'./lib.js','URL routes retain suffix semantics');
assert.equal(normalizeImportSpecifier('#alias'),'#alias','Node package aliases remain intact');
assert.equal(normalizeImportSpecifier('./style.css#part'),'./style.css','HTML URL behavior remains intact');
console.log('Bash literal hashes/spaces reach exact targets with decoy and replay controls; quoted question-mark inventory scope is explicit.');
