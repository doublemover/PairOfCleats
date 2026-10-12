import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadTypeScriptModule } from '../../../src/index/tooling/typescript/load.js';
import { createVirtualCompilerHost } from '../../../src/index/tooling/typescript/host.js';
import { createCompilerSourceReuse } from '../../../src/index/tooling/typescript/source-reuse.js';
import { preflightTypeScriptSource } from '../../../src/index/tooling/typescript/resolution.js';

const ts = loadTypeScriptModule(), root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-compiler-source-reuse-'));
assert.ok(ts, 'Installed TypeScript is required for retained-host qualification.');
const file = path.join(root, 'entry.mts'), text = 'export function render(value:number){return `${value}`;}';
const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext, noLib: true, types: [] };
const cache = createCompilerSourceReuse({ maxBytes: 8192 });
const host = (mode, settings = options, mapping = new Map()) => createVirtualCompilerHost(ts, settings, new Map(),
  mapping, mapping, ts.sys, { cache, mode });
try {
  await fs.writeFile(file, text);
  const prepared = preflightTypeScriptSource(ts, host('prepare'), file, options).sourceFile;
  assert.equal(prepared.locals, undefined, 'Preflight retains an unbound parser tree.');
  const program = ts.createProgram({ rootNames: [file], options, host: host('consume') });
  assert.equal(program.getSourceFile(file), prepared, 'The one normal Program consumes the retained SourceFile.');
  program.getTypeChecker();
  assert.ok(prepared.locals, 'Binding happens only after the handoff.');
  assert.deepEqual(cache.snapshot().parseReusedFiles, [file]);
  assert.equal(cache.snapshot().sourceBytesReused, Buffer.byteLength(text));
  assert.ok(cache.snapshot().peakRetainedBytes <= cache.snapshot().maxRetainedBytes);
  const later = preflightTypeScriptSource(ts, host('consume'), file, options).sourceFile;
  assert.notEqual(later, prepared, 'A later host cannot reuse the consumed checker arena.');

  const changedOptions = { ...options, strictNullChecks: true };
  const prepareHost = host('prepare'), fresh = preflightTypeScriptSource(ts, prepareHost, file, options).sourceFile;
  const changed = preflightTypeScriptSource(ts, host('consume', changedOptions), file, changedOptions).sourceFile;
  assert.notEqual(changed, fresh, 'Compiler project options participate in identity.');
  const mapped = preflightTypeScriptSource(ts, host('consume', options, new Map([[file, path.join(root, 'container.vue')]])), file, options).sourceFile;
  assert.notEqual(mapped, fresh, 'VFS/source mappings participate in identity.');
  const parseOptions = { languageVersion: options.target, impliedNodeFormat: ts.ModuleKind.ESNext,
    setExternalModuleIndicator: ts.getSetExternalModuleIndicator(options), jsDocParsingMode: ts.JSDocParsingMode.ParseAll };
  assert.equal(prepareHost.getSourceFile(file, parseOptions), fresh, 'Exact prepare-mode identity sees the retained tree.');
  const forced = prepareHost.getSourceFile(file, parseOptions, undefined, true);
  assert.notEqual(forced, fresh, 'Forced fresh requests bypass retained trees.');
  await fs.writeFile(file, text + '\nexport const changed=1;');
  assert.notEqual(preflightTypeScriptSource(ts, host('consume'), file, options).sourceFile, fresh, 'Current bytes are read before a hit.');
  assert.throws(() => createCompilerSourceReuse({ maxBytes: -1 }), TypeError);
  const disabled = createCompilerSourceReuse({ maxBytes: 0 });
  const disabledHost = createVirtualCompilerHost(ts, options, new Map(), new Map(), new Map(), ts.sys, { cache: disabled, mode: 'prepare' });
  preflightTypeScriptSource(ts, disabledHost, file, options);
  assert.equal(disabled.snapshot().peakRetainedBytes, 0, 'Oversize parser trees are never retained.');
  cache.clear();
  console.log('One-Program parser handoff, bounded retention and source/options/VFS/fresh invalidations passed');
} finally { cache.clear(); await fs.rm(root, { recursive: true, force: true }); }
