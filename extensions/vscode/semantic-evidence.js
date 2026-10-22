const path = require('node:path');
const { readVerifiedSource, documentOffsets } = require('./document-authority.js');

const LIMITS = Object.freeze({ records: 128, bytes: 65536, workMs: 250 });
const sameGeneration = (left, right) => left?.baseBuildId === right?.baseBuildId
  && left?.semanticRevision === right?.semanticRevision;

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
  async function show(payload, state) {
    const document = await vscode.workspace.openTextDocument({
      content: describeSemanticEvidence(payload) + `\nSeed generation source: ${state.generationSource || 'explicit immutable generation'}`
        + '\n\n' + JSON.stringify(payload, null, 2), language: 'plaintext'
    });
    await vscode.window.showTextDocument(document, { preview: true });
    if (!operations.isCurrent()) return;
    last = { payload, ...state };
  }

  async function runOperation(operation, value, state, extra = {}) {
    const request = buildSemanticRequest(operation, state.repoContext.repoRoot, state.generation, value, extra);
    const payload = await execute(operation, request, state);
    if (!payload || !operations.isCurrent()) return null;
    if (!sameGeneration(state.generation, payload.generation)) throw new Error('Semantic generation changed; restart from the seed.');
    await show(payload, { ...state, operation, request, value });
    return payload;
  }

  async function inspect(state) {
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
      const choice = await vscode.window.showQuickPick([...actions, ...candidates], {
        title: `Semantic evidence • ${payload.status || 'unknown'} • experimental`,
        placeHolder: 'Select a record for detail/trace, or return to the seed'
      });
      if (!choice || choice.action === 'back') return;
      if (choice.action === 'copy') {
        await vscode.env.clipboard.writeText(JSON.stringify(payload, null, 2));
        continue;
      }
      if (choice.action === 'plan') {
        await runOperation('enrichment', payload.enrichment.suggestions.slice(0, 8).map(item => item.taskId), state);
        if (last) await inspect(last);
        await show(payload, state);
        continue;
      }
      if (choice.action === 'more') {
        const next = await execute(state.operation, { ...state.request, cursor: payload.cursor }, state);
        if (!sameGeneration(next?.generation, state.generation)) throw new Error('Continuation generation changed. Restart from seed.');
        await show(next, state);
        await inspect(last);
        continue;
      }
      const action = await vscode.window.showQuickPick([
        { label: 'Inspect source-qualified detail', value: 'detail' },
        { label: 'Trace upstream (depth 2)', value: 'trace', direction: 'upstream' },
        { label: 'Trace downstream (depth 2)', value: 'trace', direction: 'downstream' },
        { label: 'Explain evidence and proposed enrichment', value: 'explain', direction: 'upstream' },
        { label: 'Open exact source (requires captured source mapping)', value: 'open' }
      ].filter(item => item.value === 'open' || supported(item.value)), { title: choice.label,
        placeHolder: state.transport === 'api' ? 'Only operations advertised by this service are offered' : 'Bounded canonical semantic operations' });
      if (!action) continue;
      if (action.value === 'open') {
        const source = (payload.sourceRefs || []).find(item => JSON.stringify(item.ref) === JSON.stringify(choice.record.ref));
        const target = sourceQualifiedSelection(state.repoContext, source, choice.record);
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target.file));
        const offsets = qualifiedDocumentOffsets(document, target);
        const version = document.version;
        const editor = await vscode.window.showTextDocument(document);
        if (!operations.isCurrent() || document.version !== version || document.isDirty) return;
        editor.selection = new vscode.Selection(document.positionAt(offsets.start), document.positionAt(offsets.end));
        editor.revealRange(editor.selection);
      } else {
        let extra = { direction: action.direction };
        if (action.value === 'trace' || action.value === 'explain') {
          const depth = await vscode.window.showInputBox({ prompt: 'Trace depth (1–64; records 128 / edges 512 / 64 KiB / 250 ms)', value: '2' });
          if (depth === undefined) continue;
          if (!/^\d+$/.test(depth) || Number(depth) < 1 || Number(depth) > 64) throw new Error('Trace depth must be between 1 and 64.');
          const kinds = await vscode.window.showQuickPick(['flowsTo', 'defines', 'reads', 'writes', 'callTarget',
            'constructTarget', 'argumentToParameter', 'returnToResult'], { canPickMany: true,
            title: 'Trace edge kinds (empty selection uses canonical supported kinds)' });
          if (!kinds) continue;
          const slot = await vscode.window.showQuickPick(['Any slot', 'input', 'output', 'argument', 'receiver',
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
        await runOperation(action.value, choice.record.ref, state, extra);
        if (last) await inspect(last);
        await show(payload, state);
      }
    }
  }

  return async function semanticEvidence(seedNode = null) {
    return operations.run('semantic-evidence', async () => {
      try {
        const repoContext = await resolveRepo(seedNode);
        if (!repoContext) return;
        const transport = await chooseTransport(repoContext);
        if (!transport) return;
        let cursorSeed = !seedNode && transport.transport === 'cli' ? getCursorSeed?.(repoContext) : null;
        if (!cursorSeed && !seedNode && transport.transport === 'cli' && resolveCursorSeed) {
          cursorSeed = await resolveCursorSeed(repoContext, transport);
          if (!operations.isCurrent()) return;
        }
        if (cursorSeed) {
          const route = await vscode.window.showQuickPick([
            { label: 'Use current source-qualified cursor binding', value: 'cursor' },
            { label: 'Choose selector / immutable generation', value: 'manual' }
          ], { title: 'Semantic seed: canonical binding identity or explicit selector' });
          if (!route) return;
          if (route.value === 'cursor') {
            const fresh = getCursorSeed(repoContext);
            if (!fresh || JSON.stringify(fresh) !== JSON.stringify(cursorSeed)) throw new Error('Qualified cursor identity changed. Navigate again or choose an explicit selector.');
            await runOperation('find', fresh.selector, { repoContext, generation: fresh.generation,
              generationSource: 'canonical current cursor navigation', ...transport });
            if (last) await inspect(last);
            return;
          }
        }
        let generation = null, generationSource = 'explicit immutable generation';
        if (discoverGeneration) {
          const route = await vscode.window.showQuickPick([
            { label: 'Discover published semantic generation for selected source / hit', value: 'discover' },
            { label: 'Enter immutable semantic generation', value: 'manual' }
          ], { title: 'Semantic generation (authoritative discovery or explicit selection)' });
          if (!route) return;
          if (route.value === 'discover') {
            try {
              const witness = await discoverGeneration(repoContext, transport, seedNode);
              if (witness) { generation = witness.generation; generationSource = witness.source; }
            } catch (error) {
              const correction = await vscode.window.showQuickPick([
                { label: 'Enter immutable generation explicitly', value: 'manual' }, { label: 'Return to previous evidence', value: 'back' }
              ], { title: 'Semantic generation discovery unavailable', placeHolder: error.message.slice(0, 512) });
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
        const selectorKind = await vscode.window.showQuickPick([
          ...(seedNode?.hit?.chunkUid ? ['Selected chunk ownership'] : []),
          'Current source file', 'Structural operation', 'Exact type expression', 'Scalar literal'], {
          title: 'Semantic find selector (experimental)' });
        if (!selectorKind) return;
        let selector;
        if (selectorKind === 'Selected chunk ownership') {
          selector = { field: 'chunkUid', value: seedNode.hit.chunkUid };
        } else if (selectorKind === 'Current source file') {
          const file = vscode.window.activeTextEditor?.document?.uri?.fsPath;
          const relative = file ? path.relative(repoContext.repoRoot, file).replace(/\\/g, '/') : '';
          if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Focus a saved file in the selected repository.');
          selector = { field: 'sourcePath', value: relative };
        } else if (selectorKind === 'Scalar literal') {
          const type = await vscode.window.showQuickPick(['string', 'boolean', 'null', 'number', 'bigint'],
            { title: 'Exact parser-established scalar type (no runtime value inference)' });
          if (!type) return;
          const value = type === 'null' ? '' : type === 'boolean'
            ? await vscode.window.showQuickPick(['true', 'false'], { title: 'Boolean representation' })
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
            const sources = await vscode.window.showQuickPick(['declared', 'compiler'], { canPickMany: true,
              title: 'Exact recorded type sources (availability is producer-specific)' });
            if (!sources?.length) return;
            const roles = await vscode.window.showQuickPick(['local', 'parameter', 'field', 'return'], {
              canPickMany: true, title: 'Exact recorded type roles' });
            if (!roles?.length) return;
            selector.typeExpression.sources = sources;
            selector.typeExpression.roles = roles;
          }
        }
        await runOperation('find', selector, { repoContext, generation, generationSource, ...transport });
        if (last) await inspect(last);
      } catch (error) {
        if (operations.isCurrent()) await vscode.window.showErrorMessage(`PairOfCleats semantic evidence: ${error.message}. Previous evidence remains available.`);
      }
    }, { key: 'semantic-evidence' });
  };
}

module.exports = { LIMITS, buildSemanticRequest, scalarLiteralSelector, qualifiedBindingSeed, sameGeneration, describeSemanticEvidence,
  sourceQualifiedSelection, qualifiedDocumentOffsets, createSemanticEvidenceWorkflow };
