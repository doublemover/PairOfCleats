import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';

const sha = value => createHash('sha256').update(value).digest('hex');
const between = (source, start, end, tail = '') => {
  const first = source.indexOf(start); assert.ok(first >= 0 && source.indexOf(start, first + 1) === -1, start);
  const last = source.indexOf(end, first); assert.ok(last > first, end);
  return source.slice(first, last) + tail;
};
const functionSource = (source, language) => language === 'lua'
  ? between(source, 'const gatherLuaTreeSitterNodes = ', '\n};\n\nconst buildLuaTreeSitterChunks', '\n}').slice('const gatherLuaTreeSitterNodes = '.length)
  : between(source, language === 'css' ? 'function gatherRuleNodes(' : 'function gatherChunkNodes(',
    language === 'css' ? '\n}\n\nexport function collectCssImports' : source.includes('function gatherChunkNodes(root, text, config, budget, projection')
      ? '\n}\n\nfunction gatherChunksWithQuery' : '\n}\n\n/**\n * Attempt chunk extraction', '\n}');
const measuredFunction = source => {
  const needle = source.includes('stack = [work.view(root)]') ? 'stack = [work.view(root)]' : 'stack = [root]';
  assert.equal(source.split(needle).length, 2, 'one exact stack initialization is the sole observational rewrite');
  return source.replace(needle, needle.replace('[', 'observeStack([').replace(']', '])'));
};

/** Expose private current callbacks at their actual module URL. Only an extra
 * qualification export is appended; original entrypoints and semantic owners
 * remain current. The old algorithm body is a byte-bound literal, with current
 * callback/predicate bindings, not the historical adapter's semantic behavior.
 */
export const prepareTraversalComparisonOwner = async language => {
  const spec = {
    scala: { path: 'src/lang/tree-sitter/chunking.js', saved: 'perl-chunking-original-24230.js.txt',
      blob: 'a463e75c435424152976171248bc303ac9b21648', sha256: '7e3bf4993507e8b18cb6d0e61e591c34c0b946c1edc39c25e0b7f5d6cad8a000' },
    css: { path: 'src/lang/css.js', saved: 'native-css-traversal-original-24230.js.txt',
      blob: '588de35a987fdca82313247f43d469546639144d', sha256: 'b8cd4b0b863b62c613a0ef4bac0e50daea7eca962f81cb65e592fbc02485aa5c' },
    lua: { path: 'src/lang/lua.js', saved: 'native-lua-traversal-original-24230.js.txt',
      blob: 'ea1d4fe451ffbd0a2f9e1dcd30b968e769b3d91f', sha256: 'd8e419294fd388426d873804637a175139541a1f4246c1c7670623da86e3b4e9' }
  }[language]; assert.ok(spec);
  const url = new URL('../../../' + spec.path, import.meta.url);
  const physical = await fs.readFile(url), current = physical.toString('utf8').replace(/\r\n/g, '\n');
  const original = (await fs.readFile(new URL('./' + spec.saved, import.meta.url))).toString('utf8').replace(/\r\n/g, '\n');
  assert.equal(sha(original), spec.sha256);
  assert.equal(createHash('sha1').update('blob ' + Buffer.byteLength(original) + '\0').update(original).digest('hex'), spec.blob);
  const oldGather = functionSource(original, language), currentGather = functionSource(current, language);
  const oldMeasured = measuredFunction(oldGather), currentMeasured = measuredFunction(currentGather);
  let projector = '', select;
  if (language === 'scala') {
    select = `const config = LANG_CONFIG.scala;
    const names = createNativeProjectionNames({ text, config, work });
    const projection = { work, names }, currentToChunk = toChunk;
    const makeOld = callback => { const toChunk = callback; return (${oldGather}); };
    const makeOldMeasured = callback => { const toChunk = callback; return (${oldMeasured}); };
    const callback = (node, input, selected, lines, accessor) => {
      const chunk = work.project(() => currentToChunk(work.view(node), input, selected, lines, accessor, names));
      if (chunk) work.output(chunk); return chunk;
    };
    const gather = arm === 'original' ? (instrumented ? makeOldMeasured(callback) : makeOld(callback))
      : instrumented ? (${currentMeasured}) : gatherChunkNodes;
    const selectedAt = performance.now();
    const selected = gather(root, text, config, budget, projection);
    const gatherWallMs = performance.now() - selectedAt;
    if (negative) return { chunks: null, reason: selected.reason, selectionComplete: Array.isArray(selected.chunks),
      selected: (selected.chunks || []).map(chunk => ({ name: chunk.name, start: chunk.start, end: chunk.end })), work: work.snapshot(), gatherWallMs };
    if (!selected?.chunks || selected.reason) throw new Error('Complete equivalent declaration selection required.');
    const projectedAt = performance.now(), chunks = selected.chunks;
    const calls = attachSyntaxCallFacts(work.view(root), text, chunks,
      { maxNodes: budget.maxAstNodes, maxStack: budget.maxAstStack, languageId: 'scala' });
    if (calls.truncated) throw new Error('Complete equivalent call evidence required.');
    return { chunks, work: work.snapshot(), gatherWallMs, postProjectionWallMs: performance.now() - projectedAt };`;
  } else if (language === 'css') {
    projector = `const __qualificationProject = (nodes, text, work) => {
${between(current, '    const lineIndex = buildLineIndex(text);\n    const lineAccessor = createLineAccessor(text, lineIndex);\n    const chunks = [];',
    '\n  } catch (error) {\n    if (!isNativeProjectionBudgetFailure(error)) throw error;')}
};`;
    select = `const gather = arm === 'original' ? (${oldGather}) : instrumented ? (${currentMeasured}) : gatherRuleNodes;
    const measuredOld = (${oldMeasured});
    const selectedAt = performance.now();
    const selected = arm === 'original' ? (instrumented ? measuredOld : gather)(root, budget) : gather(root, work);
    const gatherWallMs = performance.now() - selectedAt;
    const nodes = arm === 'original' ? selected?.nodes : selected;
    if (negative) return { chunks: null, reason: selected?.reason || null, selectionComplete: Array.isArray(nodes),
      selected: (nodes || []).map(node => ({ type: node.type, start: node.startIndex, end: node.endIndex })), work: work.snapshot(), gatherWallMs };
    if (!nodes || selected?.reason) throw new Error('Complete equivalent CSS selection required.');
    const projectedAt = performance.now(), chunks = __qualificationProject(nodes.map(node => work.view(node)), text, work);
    return { chunks, work: work.snapshot(), gatherWallMs, postProjectionWallMs: performance.now() - projectedAt };`;
  } else {
    projector = `const __qualificationProject = (nodes, text, rootNode, budget, work) => { let callWork = null;
${between(current, '    const lineIndex = buildLineIndex(text);\n    const lines = text.split(\'\\n\');\n    const chunks = [];\n    const declarations = new Map();',
    '\n  } catch (error) {\n    if (!isNativeProjectionBudgetFailure(error)) throw error;')}
};`;
    select = `const gather = arm === 'original' ? (instrumented ? (${oldMeasured}) : (${oldGather}))
      : instrumented ? (${currentMeasured}) : gatherLuaTreeSitterNodes;
    const selectedAt = performance.now(), nodes = arm === 'original' ? gather(root) : gather(root, work);
    const gatherWallMs = performance.now() - selectedAt;
    if (negative) return { chunks: null, reason: nodes ? null : 'historical-fixed-maxNodes', selectionComplete: Array.isArray(nodes),
      selected: (nodes || []).map(node => ({ type: node.type, start: node.startIndex, end: node.endIndex })), work: work.snapshot(), gatherWallMs };
    if (!nodes) throw new Error('Complete equivalent Lua selection required.');
    const projectedAt = performance.now(), chunks = __qualificationProject(nodes.map(node => work.view(node)), text, root, budget, work);
    return { chunks, work: work.snapshot(), gatherWallMs, postProjectionWallMs: performance.now() - projectedAt };`;
  }
  // Imports/production definitions in this exact URL supply every dependency.
  // Only the named historical gather body differs; current language callbacks,
  // scope/name owner, call-facts and generous operation budgets are shared.
  const operationAt = select.indexOf('    const selectedAt'); assert.ok(operationAt >= 0);
  const suffix = `\n${projector}\nexport const __qualificationPrepareTraversalComparison = ({ root, text, budget, arm, instrumented = false, negative = false, observeStack = value => value }) => {
    const work = createNativeProjectionWork(budget);
    ${select.slice(0, operationAt)}
    return () => {
      ${select.slice(operationAt)}
    };
  };\n`;
  return { url: url.href, moduleSource: current + suffix,
    identity: { path: spec.path, currentPhysicalSha256: sha(physical), currentLfSha256: sha(current),
      original: { commit: '24230d7960127ab7e4a01f2c040bf3d859f6b46b', blob: spec.blob, sha256: spec.sha256,
        source: 'https://github.com/doublemover/PairOfCleats/blob/24230d7960127ab7e4a01f2c040bf3d859f6b46b/' + spec.path },
      originalAlgorithmSha256: sha(oldGather), currentAlgorithmSha256: sha(currentGather),
      observationalOriginalSha256: sha(oldMeasured), observationalCurrentSha256: sha(currentMeasured),
      currentProjectorSha256: sha(projector), appendedExportSha256: sha(suffix),
      scope: 'Exact historical gather algorithm literal with current predicates and semantic callbacks;current pre-expansion-admission stack owner, not an implemented cursor or historical whole-adapter comparison.' } };
};

export const loadTraversalComparisonOwner = async language => {
  const prepared = await prepareTraversalComparisonOwner(language); let interceptions = 0;
  const hook = registerHooks({ load(selected, context, next) {
    if (selected !== prepared.url) return next(selected, context);
    interceptions++; return { format: 'module', source: prepared.moduleSource, shortCircuit: true };
  } });
  try {
    const module = await import(prepared.url); assert.equal(interceptions, 1, 'Only the selected current production module gains the private qualification export.');
    const prepare = module.__qualificationPrepareTraversalComparison;
    return { prepare, run: options => prepare(options)(), close: () => hook.deregister(), identity: { ...prepared.identity, interceptions } };
  } catch (error) { hook.deregister(); throw error; }
};
