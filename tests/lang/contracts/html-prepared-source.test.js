import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { prepareHtmlDocument, releaseHtmlDocument, getHtmlPreparationDiagnostics } from '../../../src/lang/html-prepared-document.js';
import { getImportExtraction } from '../../../src/shared/import-extraction.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const htmlUrl = new URL('../../../src/lang/html.js', import.meta.url).href;
const preparedUrl = new URL('../../../src/lang/html-prepared-document.js', import.meta.url).href;
const parseUrl = import.meta.resolve('parse5');
const treeUrl = new URL('../../../src/lang/tree-sitter.js', import.meta.url).href;
const state = { parses: [], handles: [], failParse: null, failTree: null, afterParse: null };
globalThis.htmlPreparedSourceFixture = state;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === htmlUrl && specifier === './html-prepared-document.js') return { url: 'html-prepared:owner', shortCircuit: true };
    if (context.parentURL === htmlUrl && specifier === './tree-sitter.js') return { url: 'html-prepared:tree', shortCircuit: true };
    // The prepared owner is imported above for diagnostic APIs. A query-scoped
    // copy makes its real parse boundary independently observable for the registry.
    if (context.parentURL === preparedUrl + '?observed' && specifier === 'parse5') return { url: 'html-prepared:parse', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'html-prepared:owner') return { format: 'module', shortCircuit: true, source: `
      import * as owner from ${JSON.stringify(preparedUrl + '?observed')};
      export * from ${JSON.stringify(preparedUrl + '?observed')};
      export const prepareHtmlDocument=(...args)=>{const value=owner.prepareHtmlDocument(...args);
        globalThis.htmlPreparedSourceFixture.handles.push({value,diagnostics:()=>owner.getHtmlPreparationDiagnostics(value)});return value;};` };
    if (url === 'html-prepared:parse') return { format: 'module', shortCircuit: true, source: `
      import {parse as original} from ${JSON.stringify(parseUrl)};
      export const parse=(text,options)=>{const state=globalThis.htmlPreparedSourceFixture;
        state.parses.push({text,options});if(state.failParse)throw state.failParse;
        const value=original(text,options);state.afterParse?.();return value;};` };
    if (url === 'html-prepared:tree') return { format: 'module', shortCircuit: true, source: `
      import {buildTreeSitterChunks as original} from ${JSON.stringify(treeUrl)};
      export const buildTreeSitterChunks=(...args)=>{const state=globalThis.htmlPreparedSourceFixture;
        if(state.failTree)throw state.failTree;return original(...args);};` };
    return next(url, context);
  }
});
try {
  const html = await import(htmlUrl);
  const { buildLanguageContext, collectLanguageImportResult } = await import('../../../src/index/language-registry.js');
  const documents = [
    '<!doctype html><html><head><title>Example &amp; 😀</title><meta name="description" content="Demo">'
      + '<meta name="keywords" content="one,two"><script src="./app.js?a=1&amp;b=2"></script>'
      + '<link href="./app.css"></head><body>雪\r\n<template><template><script src="./nested.js"></script>'
      + '<code lang="text">hello 😀</code></template></template><script>\r\nfunction inside(){return 2;}\r\n</script></body></html>',
    '<title>Recovered &amp; malformed</title><main><template><link href="./other.css"><div>😀',
    'plain document without useful elements'
  ];
  for (const text of documents) {
    const input = { text, mode: 'code', ext: '.html', relPath: 'same/path.html', options: { treeSitter: { enabled: false } } };
    const before = state.parses.length;
    const { lang, context } = await buildLanguageContext(input);
    assert.equal(state.parses.length - before, 1, 'real registry metadata plus chunks use one parse5 parse');
    assert.equal(context.htmlPreparation.parseCalls, 1); assert.equal(context.htmlPreparation.status, 'parsed');
    assert.equal(context.htmlPreparation.treeRetained, false); assert.equal(context.htmlPreparation.released, true);
    assert.equal(context.htmlPreparation.profile.scriptingEnabled, true);
    assert.equal(context.htmlPreparation.profile.sourceCodeLocationInfo, true);
    assert.equal(context.htmlPreparation.source.sha256, createHash('sha256').update(text, 'utf16le').digest('hex'));
    assert.equal(context.htmlPreparation.sourceStringBytes, text.length * 2);
    assert.ok(context.htmlPreparation.visits.chunks > 0); assert.equal(context.htmlPreparation.visits.metadata, context.htmlPreparation.visits.chunks);
    const imports = collectLanguageImportResult({ ...input, context });
    const metadata = html.getHtmlMetadata(text, { ...input.options, context });
    assert.equal(state.parses.length - before, 1, 'same prepared source imports and metadata do not parse again');
    assert.deepEqual(metadata, context.htmlMeta);
    assert.deepEqual(imports.entries.map(value => value.specifier), metadata.imports);
    assert.equal(imports.receipt.source.textHash, context.htmlPreparation.source.sha256);
    const relations = lang.buildRelations({ ...input, context });
    assert.deepEqual(relations.imports, metadata.imports);
    for (const fileRelations of [relations, null, { imports: [] }]) {
      const projected = lang.extractDocMeta({ ...input, context, chunk: context.htmlChunks?.[0], fileRelations });
      assert.equal(projected.title, metadata.title); assert.deepEqual(projected.scripts, metadata.scripts);
      assert.deepEqual(projected.links, metadata.links); assert.deepEqual(projected.keywords, metadata.keywords);
    }
    const standaloneChunks = html.buildHtmlChunks(text, input.options), standaloneMeta = html.getHtmlMetadata(text);
    assert.deepEqual(context.htmlChunks, standaloneChunks); assert.deepEqual(metadata, standaloneMeta);
    if (text === documents[0]) {
      assert.equal(metadata.title, 'Example & 😀'); assert.equal(metadata.description, 'Demo');
      assert.deepEqual(metadata.imports, ['./app.js?a=1&b=2', './app.css', './nested.js']);
      assert.deepEqual(metadata.keywords, ['one', 'two']);
      assert.ok(context.htmlChunks.some(chunk => chunk.name === 'inside' && text.slice(chunk.start, chunk.end).startsWith('function inside')));
      assert.ok(context.htmlChunks.some(chunk => chunk.kind === 'CodeBlock' && text.slice(chunk.start, chunk.end).includes('hello 😀')));
    }
    // Caller-visible arrays and context fields cannot rewrite private source facts.
    context.htmlMeta.imports.push('./poison.js'); context.htmlMeta.title = 'poison';
    assert.deepEqual(html.getHtmlMetadata(text, { context }).imports, metadata.imports);
    assert.equal(html.getHtmlMetadata(text, { context }).title, metadata.title);
    const other = text + '<script src="./changed.js"></script>', beforeChanged = state.parses.length;
    assert.ok(html.collectHtmlImports(other, { context }).includes('./changed.js'));
    assert.equal(state.parses.length - beforeChanged, 1, 'same path/context cannot authorize different bytes');
    assert.equal(html.releaseHtmlPreparedContext(context), true);
    const beforeReleased = state.parses.length;
    html.getHtmlMetadata(text, { context }); assert.equal(state.parses.length - beforeReleased, 1, 'released facts cannot be reused');
  }
  const text = '<title>Profile</title><noscript><link href="./no-script.css"></noscript>';
  // Actual entry points reject forged, mismatched or released prepared handles.
  // Canonical direct APIs above use the observed owner; import its handle APIs
  // explicitly so these controls exercise the same private brand.
  const owner = await import(preparedUrl + '?observed');
  for (const options of [{ scriptingEnabled: false }, { sourceCodeLocationInfo: false }]) {
    const handle = owner.prepareHtmlDocument(text, options), before = state.parses.length;
    assert.deepEqual(html.getHtmlMetadata(text, {}, handle), html.getHtmlMetadata(text));
    assert.equal(state.parses.length - before, 2, 'mismatched profile reparses canonically, including independent control');
    owner.releaseHtmlDocument(handle); assert.equal(owner.getHtmlPreparationDiagnostics(handle).treeRetained, false);
  }
  const handle = owner.prepareHtmlDocument(text), beforeWrongText = state.parses.length;
  html.getHtmlMetadata(text + 'changed', {}, handle);
  assert.equal(state.parses.length - beforeWrongText, 1);
  owner.releaseHtmlDocument(handle);
  const beforeDisposed = state.parses.length; html.getHtmlMetadata(text, {}, handle);
  assert.equal(state.parses.length - beforeDisposed, 1);
  const beforeForged = state.parses.length; html.getHtmlMetadata(text, {}, { document: {} });
  assert.equal(state.parses.length - beforeForged, 1);

  const input = { ext: '.html', relPath: 'fallback.html', mode: 'code', text, options: { treeSitter: { enabled: false } } };
  state.failParse = Object.freeze(new Error('injected parse5 failure'));
  const beforeFailure = state.parses.length, fallback = await buildLanguageContext(input);
  assert.equal(state.parses.length - beforeFailure, 1); assert.ok(fallback.context.htmlChunks.length > 0);
  assert.equal(fallback.context.htmlPreparation.status, 'parse-failed');
  assert.equal(getImportExtraction(fallback.context.htmlMeta.imports).state, 'invalid');
  assert.equal(fallback.context.htmlMeta.title, null); assert.equal(fallback.context.htmlPreparation.treeRetained, false);
  state.failParse = null;
  const primary = Object.freeze(new Error('injected chunk projection failure')); state.failTree = primary;
  await assert.rejects(buildLanguageContext(input), error => error === primary);
  assert.equal(state.handles.at(-1).diagnostics().treeRetained, false);
  assert.equal(state.handles.at(-1).diagnostics().released, true); state.failTree = null;
  const controller = new AbortController(); state.afterParse = () => controller.abort();
  await assert.rejects(buildLanguageContext({ ...input, options: { ...input.options, signal: controller.signal } }), { name: 'AbortError' });
  state.afterParse = null;
  const beforeAbort = state.parses.length;
  await assert.rejects(buildLanguageContext({ ...input, options: { signal: controller.signal } }), { name: 'AbortError' });
  assert.equal(state.parses.length, beforeAbort, 'pre-aborted preparation does not parse');
  const pending = Object.assign(new Error('unsettled parser resource'), { cacheOwnershipPending: true, cacheOwnershipReleased: () => false });
  state.failParse = pending;
  await assert.rejects(buildLanguageContext(input), error => error.cacheOwnershipPending === true && error.cacheOwnershipReleased() === false);
  state.failParse = null;
  const direct = prepareHtmlDocument(text); releaseHtmlDocument(direct);
  assert.equal(getHtmlPreparationDiagnostics(direct).released, true);
} finally { hooks.deregister(); delete globalThis.htmlPreparedSourceFixture; }
console.log('Real HTML registry shares one source/profile-owned parse5 tree, preserves complete projections and releases trees on every exit.');
