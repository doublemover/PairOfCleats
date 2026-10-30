import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: actual syntax/chunk/projection/VFS owners, no server or index.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const fixtures = {
  function: ['.jsx', 'function View() { return <div>{compute(value)}</div>; }'],
  arrow: ['.jsx', 'const View = () => <div>{compute(value)}</div>;'],
  fragment: ['.jsx', 'function View() { return <><span>{compute(value)}</span><hr /></>; }'],
  callback: ['.jsx', 'function View() { return <button onClick={() => compute(value)}>go</button>; }'],
  map: ['.jsx', 'function View() { return <div>{items.map(item => <span>{compute(item)}</span>)}</div>; }'],
  unicode: ['.jsx', '// 界😀\r\nfunction View() { return <div title="界😀">{compute(value)}</div>; }'],
  'tsx-function': ['.tsx', 'export function View(props: { value: string }) { return <div>{compute(props.value)}</div>; }'],
  'tsx-generic': ['.tsx', 'export const View = <T extends { value: string },>(props: T) => <div>{compute(props.value)}</div>;'],
  'cache-reuse': ['.jsx', 'function View() { return <><span>{compute(value)}</span><span>{second(value)}</span></>; }'],
  'extra-isolation': ['.jsx', '/* function Inner() { return hidden(value); } */\nfunction View() { return <div>{compute(value)}</div>; }'],
  'markup-edit': ['.jsx', 'function View() { return <div>{compute(value)}</div>; }'],
  malformed: ['.jsx', 'export function View( { return <div>{compute(value)}</div>; }']
};
assert.ok(Object.hasOwn(fixtures, selected));
const counterKey = '__pocJsxSyntaxOwnershipCounter';
assert.equal(Object.hasOwn(globalThis, counterKey), false);
globalThis[counterKey] = { parses: 0, loads: 0 };
const parserUrl = new URL('../../../src/lang/babel-parser.js', import.meta.url).href;
const hook = registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (url !== parserUrl) return result;
  const source = String(result.source), needle = "import { parse } from '@babel/parser';";
  assert.equal(source.split(needle).length, 2, 'instrument exactly the installed parser call boundary');
  globalThis[counterKey].loads++;
  return { ...result, source: source.replace(needle,
    "import { parse as originalParse } from '@babel/parser';\nconst parse = (...args) => { globalThis.__pocJsxSyntaxOwnershipCounter.parses++; return originalParse(...args); };") };
} });

try {
  const { discoverSegments, chunkSegments, assignSegmentUids } = await import('../../../src/index/segments.js');
  const { parseJavaScriptAst, buildCodeRelations } = await import('../../../src/lang/javascript.js');
  const { projectJavaScriptDeclaration } = await import('../../../src/lang/javascript/declaration-projection.js');
  const { createTypeScriptSyntaxContext, prepareTypeScriptSyntax } = await import('../../../src/lang/typescript/syntax-context.js');
  const { buildTypeScriptRelations } = await import('../../../src/lang/typescript.js');
  const { assignChunkUids } = await import('../../../src/index/identity/chunk-uid.js');
  const { buildToolingVirtualDocuments } = await import('../../../src/index/tooling/vfs.js');
  const { resolveEffectiveExt } = await import('../../../src/index/tooling/vfs/virtual-path.js');
  const [ext, originalText] = fixtures[selected];
  const texts = selected === 'markup-edit' ? [originalText,
    'function View() { return compute(value); }',
    'function View() { return <section><div>{compute(value)}</div></section>; }'] : [originalText];
  for (const text of texts) {
    const relPath = 'components/View' + ext, isTs = ext === '.tsx';
    const syntaxContext = isTs ? createTypeScriptSyntaxContext() : null;
    const ast = isTs ? null : parseJavaScriptAst(text, { ext });
    const syntax = isTs ? prepareTypeScriptSyntax(text, { ext, typeScriptSyntaxContext: syntaxContext }) : null;
    const context = { jsAst: ast, tsSyntax: syntax, typeScriptSyntaxContext: syntaxContext,
      treeSitter: { enabled: false }, typescript: { parser: 'typescript' } };
    const extraText = 'function Inner() { return hidden(value); }';
    const extraStart = text.indexOf(extraText);
    const extraSegments = selected === 'extra-isolation' ? [{ type: 'embedded', languageId: 'javascript',
      start: extraStart, end: extraStart + extraText.length, parentSegmentId: null, meta: {} }] : [];
    const segments = discoverSegments({ text, ext, relPath, mode: 'code',
      languageId: isTs ? 'typescript' : 'javascript', context, extraSegments,
      segmentsConfig: { cdc: { enabled: true, minFileBytes: 1 } } });
    const canonical = segments.filter(segment => !segment.parentSegmentId && segment.start === 0 && segment.end === text.length);
    assert.equal(canonical.length, 1, 'markup does not partition the canonical program, even with CDC enabled');
    assert.equal(canonical[0].type, 'code'); assert.equal(canonical[0].ext, ext);
    assert.equal(segments.some(segment => segment.languageId === 'html'), false);
    await assignSegmentUids({ text, segments, ext, mode: 'code' });
    const chunks = chunkSegments({ text, ext, relPath, mode: 'code', context, segments });
    assert.ok(chunks.length);
    for (const chunk of chunks) {
      assert.ok(Number.isSafeInteger(chunk.start) && chunk.start >= 0 && chunk.end > chunk.start && chunk.end <= text.length);
      chunk.file = relPath; chunk.ext = ext; chunk.containerLanguageId = isTs ? 'typescript' : 'javascript';
    }
    if (selected === 'malformed') {
      assert.equal(ast, null, 'invalid syntax remains unqualified');
      assert.equal(chunks.every(chunk => chunk.kind === 'Module' && !chunk.meta?.jsDeclaration), true,
        'the existing coarse fallback cannot invent a parsed declaration');
    } else {
      const view = chunks.find(chunk => chunk.name === 'View');
      assert.ok(view, 'the named component survives markup boundaries');
      const declarationStart = text.indexOf('function View') >= 0 ? text.indexOf('function View') : text.indexOf('View =');
      const declarationEnd = text.endsWith(';') ? text.length - 1 : text.length;
      assert.ok(view.start <= declarationStart && view.end >= declarationEnd,
        'the complete independently authored declaration is contained in its chunk');
      assert.equal(text.slice(view.start, view.end).includes('compute('), true);
      assert.equal(view.segment, undefined, 'the canonical component retains full-file syntax caches and source ownership');
      const relations = isTs ? buildTypeScriptRelations(text, chunks, { ext, typeScriptSyntaxContext: syntaxContext })
        : buildCodeRelations(text, relPath, { ext, ast });
      const call = relations.callDetails.find(detail => detail.callee === 'compute');
      assert.ok(call, 'the expression island retains its actual source call');
      assert.equal(call.start, text.indexOf('compute('));
      assert.equal(text.slice(call.start, call.end).startsWith('compute('), true);
      assert.ok(call.start >= view.start && call.end <= view.end);
      if (!isTs) {
        const projection = projectJavaScriptDeclaration(text, view, relations);
        assert.equal(projection.join.exact, true);
        assert.equal(projection.javascriptDeclaration.occurrenceId, view.meta.jsDeclaration.id);
        assert.ok(call.evaluationOwner, 'JS expression calls retain a source-qualified evaluation owner');
        assert.ok(call.evaluationOwner.ownerRange.start >= view.start && call.evaluationOwner.ownerRange.end <= view.end);
      } else {
        assert.equal(syntaxContext.parses, 1, 'TypeScript native syntax is prepared once and reused by chunking');
        assert.equal(syntaxContext.babelParses, 1, 'the separate TS relation dialect is prepared once');
      }
      if (selected === 'cache-reuse') {
        assert.equal(globalThis[counterKey].loads, 1); assert.equal(globalThis[counterKey].parses, 1,
          'discovery/chunking/relations share the already prepared JSX parser owner');
      }
      if (selected === 'extra-isolation') {
        const inner = chunks.find(chunk => chunk.name === 'Inner');
        assert.ok(inner); assert.equal(text.slice(inner.start, inner.end), extraText);
        assert.ok(inner.segment, 'an independently sliced extra does not inherit the full-file AST');
        assert.equal(globalThis[counterKey].parses, 2);
      }
    }
    await assignChunkUids({ chunks, fileText: text, fileRelPath: relPath, strict: true });
    const { documents, targets } = await buildToolingVirtualDocuments({ chunks,
      fileTextByPath: new Map([[relPath, text]]), strict: true });
    assert.equal(targets.length, chunks.length);
    const chunksById = new Map(chunks.map(chunk => [chunk.chunkUid, chunk]));
    const docsByPath = new Map(documents.map(doc => [doc.virtualPath, doc]));
    for (const target of targets) {
      const chunk = chunksById.get(target.chunkRef.chunkUid), doc = docsByPath.get(target.virtualPath);
      assert.ok(chunk && doc);
      assert.equal(doc.text.slice(target.virtualRange.start, target.virtualRange.end), text.slice(chunk.start, chunk.end));
      if (!chunk.segment) {
        assert.equal(doc.text, text); assert.equal(target.ext, ext);
        assert.equal(doc.effectiveExt, ext, 'file-based tooling retains the admitted JSX/TSX dialect');
        assert.equal(target.symbolHint.name, chunk.name);
      }
    }
  }
  assert.equal(resolveEffectiveExt({ languageId: 'html', containerExt: '.tsx' }), '.html',
    'a genuinely separate language projection still keeps its own extension');
} finally {
  hook.deregister(); delete globalThis[counterKey];
}
console.log('JSX syntax ownership ' + selected + ' passed');
