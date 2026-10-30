import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fingerprintLoadedNativeArtifact } from '../../../src/lang/tree-sitter/native-artifact-identity.js';

// Synthetic loaded-module metadata exercises only the bounded file-identity
// helper. It does not load/qualify a native binary or execute a module.
const root = fs.mkdtempSync(path.join(os.tmpdir(),'poc-native-identity-'));
try {
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'fixture-native'}));
  fs.writeFileSync(path.join(root,'index.js'),'installed wrapper');
  fs.writeFileSync(path.join(root,'binding.node'),'selected installed binding');
  fs.writeFileSync(path.join(root,'loader.js'),'shared native loader');
  fs.writeFileSync(path.join(root,'foreign.node'),'another grammar');
  const value = {}, binding = {filename:path.join(root,'binding.node'),exports:value,children:[]};
  const loader = {filename:path.join(root,'loader.js'),exports:()=>{},children:[binding]};
  const wrapper = {filename:path.join(root,'index.js'),exports:value,children:[loader]};
  const require = {cache:{wrapper,loader,binding},resolve:()=>wrapper.filename};
  const fingerprint = () => fingerprintLoadedNativeArtifact({require,value,moduleName:'fixture-native'});
  const initial = fingerprint(); assert.match(initial,/^[a-f0-9]{64}$/);
  const foreign = {filename:path.join(root,'foreign.node'),exports:{},children:[]};
  require.cache.foreign = foreign; loader.children.push(foreign);
  assert.equal(fingerprint(),initial,'shared loader history cannot change selected native binding identity');
  fs.writeFileSync(path.join(root,'binding.node'),'changed installed binding');
  assert.notEqual(fingerprint(),initial,'actual selected binding content owns identity');
  assert.equal(fingerprintLoadedNativeArtifact({require,value:{},moduleName:'fixture-native'}),null);
  const parserRequire = { ...require,cache:{ ...require.cache,binding:{...binding,exports:{Parser:value}} } };
  assert.match(fingerprintLoadedNativeArtifact({require:parserRequire,value,moduleName:'fixture-native',exportKey:'Parser'}),/^[a-f0-9]{64}$/);
  assert.equal(fingerprintLoadedNativeArtifact({require:parserRequire,value,moduleName:'fixture-native'}),null,
    'a wrapper export without its selected native object cannot establish binding identity');
  const sparse = path.join(root,'binding.node'); fs.truncateSync(sparse,64 * 1024 * 1024 + 1);
  assert.equal(fingerprint(),null,'oversized binding identity is unavailable before reading its full payload');
} finally { fs.rmSync(root,{recursive:true,force:true}); }
console.log('loaded native artifact content, selected loader closure and byte admission controls passed');
