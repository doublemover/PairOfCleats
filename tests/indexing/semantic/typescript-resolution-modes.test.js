import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { createVirtualCompilerHost } from '../../../src/index/tooling/typescript/host.js';
import { preflightTypeScriptSource } from '../../../src/index/tooling/typescript/resolution.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-resolution-modes-'));
const key = file => ts.sys.useCaseSensitiveFileNames ? path.resolve(file) : path.resolve(file).toLowerCase();
const put = async (file, text) => { const target = path.join(root, file); await fs.mkdir(path.dirname(target), {recursive:true}); await fs.writeFile(target,text); return target; };
try {
  await put('package.json', JSON.stringify({type:'module'}));
  const exportsFor = {'.':{import:'./esm.d.mts',require:'./cjs.d.cts'}};
  for(const name of ['dual','@types/typed']) {
    await put('node_modules/'+name+'/package.json', JSON.stringify({name,exports:exportsFor}));
    await put('node_modules/'+name+'/esm.d.mts', 'export type T = "import"; export default 1;');
    await put('node_modules/'+name+'/cjs.d.cts', 'export type T = "require"; export default 2;');
  }
  await put('node_modules/condition/package.json', JSON.stringify({name:'condition',exports:{'.':{special:'./special.d.ts',default:'./default.d.ts'}}}));
  await put('node_modules/condition/special.d.ts','export default 3;');
  await put('node_modules/condition/default.d.ts','export default 4;');
  const source = await put('entry.mts',[
    '/// <reference types="typed" resolution-mode="require" />',
    'import value from "dual";',
    'import required = require("dual");',
    'type T = import("dual", {with: {"resolution-mode": "require"}}).T;',
    'const lazy = import("dual");',
    'import custom from "condition";'
  ].join('\r\n'));
  const options={module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,target:ts.ScriptTarget.ESNext,noLib:true,types:[],customConditions:['special']};
  assert.throws(()=>createVirtualCompilerHost({...ts,getModeForUsageLocation:undefined},options,new Map()),error=>error.code==='ERR_SEMANTIC_DEPENDENCY_UNSEALED');
  const host=createVirtualCompilerHost(ts,options,new Map());
  const preflight=preflightTypeScriptSource(ts,host,source,options);
  assert.equal(preflight.sourceFile.text,await fs.readFile(source,'utf8'));
  assert.deepEqual(preflight.modules.filter(row=>row.literal.text==='dual').map(row=>row.mode),[ts.ModuleKind.ESNext,ts.ModuleKind.CommonJS,ts.ModuleKind.CommonJS,ts.ModuleKind.ESNext]);
  for(const row of preflight.modules.filter(row=>row.literal.text==='dual'))assert.ok(row.resolution.resolvedModule.resolvedFileName.endsWith(row.mode===ts.ModuleKind.ESNext?'esm.d.mts':'cjs.d.cts'));
  assert.ok(preflight.modules.find(row=>row.literal.text==='condition').resolution.resolvedModule.resolvedFileName.endsWith('special.d.ts'));
  assert.equal(preflight.types[0].mode,ts.ModuleKind.CommonJS);
  assert.ok(preflight.types[0].resolution.resolvedTypeReferenceDirective.resolvedFileName.endsWith('cjs.d.cts'));
  // One execution Program only; preflight itself constructs none.
  const program=ts.createProgram([source],options,host), actual=program.getSourceFile(source);
  for(const row of preflight.modules) {
    const resolved=program.getResolvedModule(actual,row.literal.text,row.mode);
    assert.equal(resolved.resolvedModule.resolvedFileName,row.resolution.resolvedModule.resolvedFileName);
  }
  const common = await put('entry.cts','import value from "dual"; const lazy = import("dual");');
  const commonResult=preflightTypeScriptSource(ts,host,common,options);
  assert.deepEqual(commonResult.modules.map(row=>row.mode),[ts.ModuleKind.CommonJS,ts.ModuleKind.ESNext]);
  const javascript=await put('entry.cjs','const value = require("dual"); const lazy = import("dual");');
  assert.deepEqual(preflightTypeScriptSource(ts,host,javascript,options).modules.map(row=>row.mode),[ts.ModuleKind.CommonJS,ts.ModuleKind.ESNext]);
  const typeDefault = await put('type-default.mts','/// <reference types="typed" />');
  assert.equal(preflightTypeScriptSource(ts,host,typeDefault,options).types[0].mode,ts.ModuleKind.ESNext);
  const redirected={commandLine:{options:{...options,customConditions:[]}}};
  const custom=preflight.modules.find(row=>row.literal.text==='condition').literal;
  assert.ok(host.resolveModuleNameLiterals([custom],source,redirected,options,preflight.sourceFile)[0].resolvedModule.resolvedFileName.endsWith('default.d.ts'),'referenced-project options replace parent conditions');
  const original=await put('local.ts','export const local = 1;'), virtual=path.join(root,'__vfs','local.ts');
  const container=await put('component.vue','template'), embedded=path.join(root,'__vfs','component.vue.ts');
  const vfs=new Map([[key(virtual),'export const local = 1;'],[key(embedded),'import {local} from "./local.js";']]);
  const mapped=createVirtualCompilerHost(ts,options,vfs,new Map([[key(virtual),original]]),new Map([[key(virtual),original],[key(embedded),container]]));
  const embeddedResult=preflightTypeScriptSource(ts,mapped,embedded,options);
  assert.equal(embeddedResult.modules[0].resolution.resolvedModule.resolvedFileName,key(virtual),'exact original source resolution remaps to existing virtual target');
  assert.equal(embeddedResult.modules[0].mode,ts.ModuleKind.ESNext,'embedded mode uses original container package with virtual language extension');
  console.log('TypeScript NodeNext import/require/import-type/type-reference/condition/project-option/VFS construction cases passed');
} finally { await fs.rm(root,{recursive:true,force:true}); }
