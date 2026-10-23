const path = require('node:path');
const { readVerifiedSource, documentOffsets, createDocumentAuthority, assertQualifiedEditor } = require('./document-authority.js');
const { captureEditorFailure, reportEditorFailure, editorFailureEvidence } = require('./editor-failure-evidence.js');

const LIMITS = Object.freeze({ records: 128, bytes: 65536, workMs: 250 });
const sameGeneration = (left, right) => left?.baseBuildId === right?.baseBuildId
  && left?.semanticRevision === right?.semanticRevision;

function captureSemanticData(value) {
  const encoded = JSON.stringify(value);
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > LIMITS.bytes) throw new Error('Semantic editor data exceeds the existing 64 KiB response/request bound.');
  const captured = JSON.parse(encoded);
  const freeze = (value, depth = 0) => {
    if (!value || typeof value !== 'object') return value;
    if (depth > 64) throw new Error('Semantic editor data exceeds 64 nesting levels.');
    for (const child of Object.values(value)) freeze(child, depth + 1);
    return Object.freeze(value);
  };
  return freeze(captured);
}

function captureSemanticResponse(original) {
  if (!original || typeof original !== 'object' || Array.isArray(original)) {
    throw new Error('Semantic operation returned no object evidence.', { cause: original });
  }
  return captureSemanticData(original);
}

function qualifiedBindingSeed(payload) {
  if (payload?.status !== 'resolved' || payload.binding?.status !== 'resolved'
    || typeof payload.generation?.baseBuildId !== 'string' || !payload.generation.baseBuildId
    || payload.generation.semanticRevision !== 0 || typeof payload.binding.targetId !== 'string'
    || payload.binding.targetId.length > 256) return null;
  let target;
  try { target = JSON.parse(payload.binding.targetId); } catch { return null; }
  if (!target || !/^(?:sy1|sa1):[a-f0-9]{64}$/.test(target.partitionId || '')
    || !Number.isSafeInteger(target.localId) || target.localId < 0
    || Object.keys(target).some(key => !['partitionId', 'localId'].includes(key))) return null;
  return { generation: { ...payload.generation }, selector: { target } };
}

function scalarLiteralSelector(type, value = '') {
  let representation = String(value);
  if (type === 'string') representation = JSON.stringify(representation);
  else if (type === 'null') representation = 'null';
  else if (type === 'boolean') {
    if (!['true', 'false'].includes(representation)) throw new Error('Boolean representation must be true or false.');
  } else if (type === 'number') {
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(representation)
      || representation !== representation.trim()
      || !Number.isFinite(Number(representation))) throw new Error('Use a finite recorded decimal number representation.');
  } else if (type === 'bigint') {
    if (!/^(?:0|-?[1-9]\d*)$/.test(representation)
      || representation !== representation.trim()) throw new Error('Use a canonical decimal bigint representation without an n suffix.');
  } else throw new Error('Unsupported scalar literal type.');
  if (Buffer.byteLength(representation) > 65536) throw new Error('Scalar representation exceeds the 64 KiB selector bound.');
  return { literal: { type, representation } };
}

function buildSemanticRequest(operation, repoRoot, generation, value, extra = {}) {
  if (!generation?.baseBuildId || generation.semanticRevision !== 0) throw new Error('A pinned semantic generation is required.');
  const common = { repoRoot, generation };
  if (operation === 'find') return { ...common, selector: value, limits: { ...LIMITS } };
  if (operation === 'detail') return { ...common, refs: [value], fields: ['span', 'scope', 'data'],
    include: ['operands', 'names', 'ownership'], limits: { ...LIMITS, rows: 512 } };
  if (operation === 'enrichment') return { ...common, schemaVersion: 1, action: 'plan', taskIds: value };
  return { ...common, seed: value, direction: extra.direction || 'upstream',
    ...(extra.kinds?.length ? { kinds: extra.kinds } : {}), ...(extra.slot ? { slot: extra.slot } : {}),
    limits: { ...LIMITS, edges: 512, depth: Math.min(64, Math.max(1, extra.depth || 2)) } };
}

function describeSemanticEvidence(payload) {
  return ['Experimental indexed semantic evidence; qualification pending.',
    `Generation: ${payload.generation?.baseBuildId || 'unknown'} / ${payload.generation?.semanticRevision ?? 'unknown'}`,
    `Response: ${payload.status || 'unknown'}; ${payload.records?.length || 0} record(s), ${payload.edges?.length || 0} edge(s)`,
    `Extraction coverage: ${JSON.stringify(payload.coverage?.extraction || [])}`,
    `Analysis coverage: ${JSON.stringify(payload.coverage?.analysis || [])}`,
    `Response coverage: ${JSON.stringify(payload.coverage?.response || {})}`,
    `Stopped frontier: ${JSON.stringify(payload.frontier || [])}`,
    ...(payload.warnings || []).map(warning => `Warning: ${warning}`),
    'An empty or partial response does not prove absence of flow.'].join('\n');
}

function sourceQualifiedSelection(repoContext, source, record) {
  if (source?.coordinateUnit !== 'utf16' || !/^[a-f0-9]{64}$/.test(source.sourceHash || '')) {
    throw new Error('Precise source opening requires a UTF-16 source hash; byte/generated mappings remain unavailable here.');
  }
  const relative = String(source.path || '').replace(/\\/g, '/');
  if (!relative || relative.startsWith('/') || relative.includes(':') || relative.split('/').some(part => part === '..' || part === '.')) {
    throw new Error('Evidence source is outside the selected repository.');
  }
  const file = path.resolve(repoContext.repoRoot, relative);
  const verified = readVerifiedSource({ repoRoot: repoContext.repoRoot, file, sourceHash: source.sourceHash });
  const span = record?.span;
  if (!Array.isArray(span) || span.length !== 2 || !Number.isSafeInteger(span[0]) || !Number.isSafeInteger(span[1]) || span[0] < 0 || span[1] < span[0]) {
    throw new Error('This record has no exact source span.');
  }
  if (span[1] > verified.sourceText.length) throw new Error('Indexed source range exceeds its qualified document.');
  return { ...verified, start: span[0], end: span[1] };
}

function qualifiedDocumentOffsets(document, target) {
  return documentOffsets(document, target);
}

/** Native commands only. Every operation calls the existing typed consumer;
 * suggestions are displayed as data and never executed as response commands. */
function createSemanticEvidenceWorkflow({ vscode, operations, resolveRepo, execute, chooseTransport,
  getCursorSeed = null, resolveCursorSeed = null, discoverGeneration = null }) {
  let last = null;
  async function pick(items, options) {
    const issued = Object.freeze(items.map(item => item && typeof item === 'object' ? Object.freeze({ ...item }) : item));
    const selected = await vscode.window.showQuickPick(issued, options);
    if (!operations.isCurrent() || selected == null) return undefined;
    if (!options.canPickMany) {
      if (!issued.includes(selected)) throw new Error('Semantic selection is not an original item from this picker.');
      return selected;
    }
    if (!Array.isArray(selected)) throw new Error('Semantic multi-selection requires original picker items.');
    const choices = [], seen = new Set();
    for (let index = 0; index < selected.length; index++) {
      if (!Object.hasOwn(selected, index)) throw new Error('Semantic multi-selection requires dense original picker items.');
      const item = selected[index];
      if (!issued.includes(item) || seen.has(item)) throw new Error('Semantic multi-selection requires distinct original picker items.');
      seen.add(item); choices.push(item);
    }
    return choices;
  }
  async function show(payload, state) {
    if (!operations.isCurrent()) return null;
    const document = await vscode.workspace.openTextDocument({
      content: describeSemanticEvidence(payload) + `\nSeed generation source: ${state.generationSource || 'explicit immutable generation'}`
        + '\n\n' + JSON.stringify(payload, null, 2), language: 'plaintext'
    });
    if (!operations.isCurrent()) return null;
    await vscode.window.showTextDocument(document, { preview: true });
    if (!operations.isCurrent()) return null;
    last = Object.freeze({ ...state, payload });
    return last;
  }

  async function runOperation(operation, value, state, extra = {}) {
    if (!operations.isCurrent()) return null;
    const generation = captureSemanticData(state.generation);
    const selectedState = Object.freeze({ ...state, generation });
    const request = captureSemanticData(buildSemanticRequest(operation, state.repoContext.repoRoot, generation, value, extra));
    const original = await execute(operation, request, selectedState);
    if (!operations.isCurrent()) return null;
    const payload = captureSemanticResponse(original);
    if (!sameGeneration(generation, payload.generation)) throw new Error('Semantic generation changed; restart from the seed.');
    return show(payload, { ...selectedState, operation, request, value: operation === 'find' ? request.selector : value });
  }

  async function inspect(state, failures) {
    while (operations.isCurrent()) {
      const payload = state.payload;
      const candidates = (payload.records || []).map(record => ({
        label: `${record.kind} ${record.ref?.partitionId}:${record.ref?.localId}`,
        description: record.availableFieldGroups?.join(', ') || 'coverage unknown', record
      }));
      const actions = [{ label: 'Back to seed / previous result', action: 'back' },
        { label: 'Copy captured evidence JSON', action: 'copy' }];
      const supported = operation => state.transport !== 'api'
        || state.execution?.capabilities?.[`semantic-${operation}`] === true;
      if (payload.enrichment?.suggestions?.length && supported('enrichment')) actions.push({ label: 'Inspect proposed enrichment plan (does not enqueue)', action: 'plan' });
      if (payload.cursor && state.transport === 'api') actions.push({ label: 'More (bounded page, same generation)', action: 'more' });
      const choice = await pick([...actions, ...candidates], {
        title: `Semantic evidence • ${payload.status || 'unknown'} • experimental`,
        placeHolder: 'Select a record for detail/trace, or return to the seed'
      });
      if (!choice || choice.action === 'back') return;
      try {
      if (choice.action === 'copy') {
        await vscode.env.clipboard.writeText(JSON.stringify(payload, null, 2));
        continue;
      }
      if (choice.action === 'plan') {
        const proposed = await runOperation('enrichment', payload.enrichment.suggestions.slice(0, 8).map(item => item.taskId), state);
        if (proposed) await inspect(proposed, failures);
        await show(payload, state);
        continue;
      }
      if (choice.action === 'more') {
        const original = await execute(state.operation, captureSemanticData({ ...state.request, cursor: payload.cursor }), state);
        if (!operations.isCurrent()) return;
        const next = captureSemanticResponse(original);
        if (!sameGeneration(next?.generation, state.generation)) throw new Error('Continuation generation changed. Restart from seed.');
        const page = await show(next, state);
        if (page) await inspect(page, failures);
        await show(payload, state);
        continue;
      }
      const action = await pick([
        { label: 'Inspect source-qualified detail', value: 'detail' },
        { label: 'Trace upstream (depth 2)', value: 'trace', direction: 'upstream' },
        { label: 'Trace downstream (depth 2)', value: 'trace', direction: 'downstream' },
        { label: 'Explain evidence and proposed enrichment', value: 'explain', direction: 'upstream' },
        { label: 'Open exact source (requires captured source mapping)', value: 'open' }
      ].filter(item => item.value === 'open' || supported(item.value)), { title: choice.label,
        placeHolder: state.transport === 'api' ? 'Only operations advertised by this service are offered' : 'Bounded canonical semantic operations' });
      if (!action) continue;
      if (action.value === 'open') {
        const source = (payload.sourceRefs || []).find(item => item?.ref?.partitionId === choice.record.ref?.partitionId
          && item?.ref?.localId === choice.record.ref?.localId);
        const target = sourceQualifiedSelection(state.repoContext, source, choice.record);
        const authority = createDocumentAuthority({ workspace: vscode.workspace, isCurrent: () => operations.isCurrent(), maxDocuments: 1 });
        const qualified = await authority.qualify({ repoRoot: state.repoContext.repoRoot, file: target.file,
          uri: vscode.Uri.file(target.file), sourceHash: target.sourceHash, span: { start: target.start, end: target.end } });
        if (!qualified || !operations.isCurrent()) return;
        const editor = await vscode.window.showTextDocument(qualified.document);
        await authority.assertCurrent();
        if (!operations.isCurrent()) return;
        assertQualifiedEditor(editor, qualified);
        editor.selection = new vscode.Selection(qualified.document.positionAt(qualified.offsets.start), qualified.document.positionAt(qualified.offsets.end));
        editor.revealRange(editor.selection);
      } else {
        let extra = { direction: action.direction };
        if (action.value === 'trace' || action.value === 'explain') {
          const depth = await vscode.window.showInputBox({ prompt: 'Trace depth (1–64; records 128 / edges 512 / 64 KiB / 250 ms)', value: '2' });
          if (depth === undefined) continue;
          if (!/^\d+$/.test(depth) || Number(depth) < 1 || Number(depth) > 64) throw new Error('Trace depth must be between 1 and 64.');
          const kinds = await pick(['flowsTo', 'defines', 'reads', 'writes', 'callTarget',
            'constructTarget', 'argumentToParameter', 'returnToResult'], { canPickMany: true,
            title: 'Trace edge kinds (empty selection uses canonical supported kinds)' });
          if (!kinds) continue;
          const slot = await pick(['Any slot', 'input', 'output', 'argument', 'receiver',
            'parameter', 'returnValue', 'propertyValue', 'element'], { title: 'Trace slot' });
          if (!slot) continue;
          extra = { ...extra, depth: Number(depth), kinds };
          if (slot !== 'Any slot') {
            const ordinal = await vscode.window.showInputBox({ prompt: `${slot} ordinal (zero based)`, value: '0' });
            if (ordinal === undefined) continue;
            if (!/^\d+$/.test(ordinal) || !Number.isSafeInteger(Number(ordinal))) throw new Error('Slot ordinal must be a nonnegative safe integer.');
            extra.slot = { name: slot, ordinal: Number(ordinal) };
          }
        }
        const detail = await runOperation(action.value, choice.record.ref, state, extra);
        if (detail) await inspect(detail, failures);
        await show(payload, state);
      }
      } catch (error) {
        failures.push(await reportEditorFailure(error, { isCurrent: () => operations.isCurrent(),
          notify: message => vscode.window.showErrorMessage(message), prefix: 'PairOfCleats semantic evidence: ',
          suffix: '. Previous evidence is retained; choose another action or return.' }));
        if (operations.isCurrent()) await show(payload, state);
      }
    }
  }

  return async function semanticEvidence(seedNode = null) {
    return operations.run('semantic-evidence', async () => {
      const failures = [];
      await (async () => {
        try {
          const selectedChunkUid = seedNode?.hit?.chunkUid;
          const resolved = await resolveRepo(seedNode);
          if (!resolved || !operations.isCurrent()) return;
          const repoContext = Object.freeze({ ...resolved });
          const chosenTransport = await chooseTransport(repoContext);
          if (!chosenTransport || !operations.isCurrent()) return;
          const transport = Object.freeze({ ...chosenTransport,
            ...(chosenTransport.execution ? { execution: Object.freeze({ ...chosenTransport.execution,
              capabilities: Object.freeze({ ...chosenTransport.execution.capabilities }) }) } : {}),
            ...(chosenTransport.serviceMapping ? { serviceMapping: Object.freeze({ ...chosenTransport.serviceMapping }) } : {}) });
          let cursorSeed = !seedNode && transport.transport === 'cli' ? getCursorSeed?.(repoContext) : null;
          if (!cursorSeed && !seedNode && transport.transport === 'cli' && resolveCursorSeed) {
            cursorSeed = await resolveCursorSeed(repoContext, transport);
            if (!operations.isCurrent()) return;
          }
          if (cursorSeed) {
            cursorSeed = captureSemanticData(cursorSeed);
            const route = await pick([
              { label: 'Use current source-qualified cursor binding', value: 'cursor' },
              { label: 'Choose selector / immutable generation', value: 'manual' }
            ], { title: 'Semantic seed: canonical binding identity or explicit selector' });
            if (!route) return;
            if (route.value === 'cursor') {
              const fresh = getCursorSeed?.(repoContext);
              if (!fresh || JSON.stringify(fresh) !== JSON.stringify(cursorSeed)) throw new Error('Qualified cursor identity changed. Navigate again or choose an explicit selector.');
              const found = await runOperation('find', fresh.selector, { repoContext, generation: fresh.generation,
                generationSource: 'canonical current cursor navigation', ...transport });
              if (found) await inspect(found, failures);
              return;
            }
          }
          let generation = null, generationSource = 'explicit immutable generation';
          if (discoverGeneration) {
            const route = await pick([
              { label: 'Discover published semantic generation for selected source / hit', value: 'discover' },
              { label: 'Enter immutable semantic generation', value: 'manual' }
            ], { title: 'Semantic generation (authoritative discovery or explicit selection)' });
            if (!route) return;
            if (route.value === 'discover') {
              try {
                const witness = await discoverGeneration(repoContext, transport, seedNode);
                if (!operations.isCurrent()) return;
                if (witness) { generation = witness.generation; generationSource = witness.source; }
              } catch (error) {
                const failure = captureEditorFailure(error); failures.push(failure);
                if (!operations.isCurrent()) return;
                const correction = await pick([
                  { label: 'Enter immutable generation explicitly', value: 'manual' }, { label: 'Return to previous evidence', value: 'back' }
                ], { title: 'Semantic generation discovery unavailable', placeHolder: failure.message.slice(0, 512) });
                if (correction?.value !== 'manual') return;
              }
            }
          }
          if (!generation) {
            const buildId = await vscode.window.showInputBox({ prompt: 'Exact semantic baseBuildId (from indexed evidence/manifest)',
              value: last?.repoContext.repoRoot === repoContext.repoRoot ? last.generation.baseBuildId : '' });
            if (!buildId?.trim()) return;
            if (/[\\/:\0]/.test(buildId) || ['.', '..'].includes(buildId)) throw new Error('Use a single immutable build identifier.');
            generation = { baseBuildId: buildId.trim(), semanticRevision: 0 };
          }
          const selectorKind = await pick([
            ...(typeof selectedChunkUid === 'string' && selectedChunkUid ? ['Selected chunk ownership'] : []),
            'Current source file', 'Structural operation', 'Exact type expression', 'Scalar literal'], {
            title: 'Semantic find selector (experimental)' });
          if (!selectorKind) return;
          let selector;
          if (selectorKind === 'Selected chunk ownership') {
            selector = { field: 'chunkUid', value: selectedChunkUid };
          } else if (selectorKind === 'Current source file') {
            const file = vscode.window.activeTextEditor?.document?.uri?.fsPath;
            const relative = file ? path.relative(repoContext.repoRoot, file).replace(/\\/g, '/') : '';
            if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Focus a saved file in the selected repository.');
            selector = { field: 'sourcePath', value: relative };
          } else if (selectorKind === 'Scalar literal') {
            const type = await pick(['string', 'boolean', 'null', 'number', 'bigint'],
              { title: 'Exact parser-established scalar type (no runtime value inference)' });
            if (!type) return;
            const value = type === 'null' ? '' : type === 'boolean'
              ? await pick(['true', 'false'], { title: 'Boolean representation' })
              : await vscode.window.showInputBox({ prompt: type === 'string' ? 'String value (empty is valid)'
                : `Exact recorded ${type} representation (decimal; bigint has no n suffix)` });
            if (value === undefined) return;
            selector = scalarLiteralSelector(type, value);
          } else {
            const value = await vscode.window.showInputBox({ prompt: `${selectorKind}: exact value` });
            if (!value) return;
            selector = selectorKind === 'Exact type expression'
              ? { typeExpression: { expression: value, match: 'exact-expression', sources: ['declared'], roles: ['local', 'parameter', 'field', 'return'] } }
              : { field: 'operation', value };
            if (selector.typeExpression) {
              const sources = await pick(['declared', 'compiler'], { canPickMany: true,
                title: 'Exact recorded type sources (availability is producer-specific)' });
              if (!sources?.length) return;
              const roles = await pick(['local', 'parameter', 'field', 'return'], {
                canPickMany: true, title: 'Exact recorded type roles' });
              if (!roles?.length) return;
              selector.typeExpression.sources = sources;
              selector.typeExpression.roles = roles;
            }
          }
          const found = await runOperation('find', selector, { repoContext, generation, generationSource, ...transport });
          if (found) await inspect(found, failures);
        } catch (error) {
          failures.push(await reportEditorFailure(error, { isCurrent: () => operations.isCurrent(),
            notify: message => vscode.window.showErrorMessage(message), prefix: 'PairOfCleats semantic evidence: ',
            suffix: '. Previous evidence remains available.' }));
        }
      })();
      return editorFailureEvidence(failures);
    }, { key: 'semantic-evidence' });
  };
}

module.exports = { LIMITS, buildSemanticRequest, scalarLiteralSelector, qualifiedBindingSeed, sameGeneration, describeSemanticEvidence,
  sourceQualifiedSelection, qualifiedDocumentOffsets, createSemanticEvidenceWorkflow };
