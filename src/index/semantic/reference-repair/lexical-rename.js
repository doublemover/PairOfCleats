import { canonicalSemanticJson, semanticHash } from '../identity.js';
import { createSemanticSourceSnapshot } from '../source.js';
import { admitOwnedSemanticSourceSnapshot } from '../source-snapshot-admission.js';
import { resolveLexicalBinding } from '../bindings/lexical.js';

const key = canonicalSemanticJson;
const sameTargets = (left, right) => left.status === right.status
  && key(left.targets) === key(right.targets) && key(left.rejected) === key(right.rejected);
const boundary = (text, offset) => offset === 0 || offset === text.length
  || !(text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff
    && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff);
const invalid = message => { throw Object.assign(new TypeError(message), { code: 'ERR_REFERENCE_REPAIR_CONTRACT' }); };

/**
 * Inert source overlay for one explicit lexical rename. The caller supplies the
 * admitted reference universe; the planner never enumerates files or applies edits.
 * This restricted model transports declaration identity through an explicit
 * unchanged-scope correspondence, not through a rewritten public source ID.
 */
export const proposeLexicalRename = ({ world, profile, scopes, declarations, sources,
  target, declarationSite, occurrences, newName, referenceUniverse,
  maxQueries = 4096, maxVisits = 4096, maxCandidates = 128, maxWitnessRefs = 16384,
  maxEvidenceBytes = 4 * 1024 * 1024, maxSourceBytes = 8 * 1024 * 1024, signal }) => {
  if (typeof newName !== 'string' || newName.length > 512 || !/^[$_\p{ID_Start}][$\u200c\u200d_\p{ID_Continue}]*$/u.test(newName)) {
    invalid('Rename requires one lexical identifier.');
  }
  if (!Array.isArray(occurrences) || occurrences.length > 16384 || !Array.isArray(sources)
    || sources.length > 256 || !Number.isSafeInteger(maxQueries) || maxQueries < 0 || maxQueries > 32769
    || !Number.isSafeInteger(maxEvidenceBytes) || maxEvidenceBytes < 1024 || maxEvidenceBytes > 4 * 1024 * 1024
    || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1) invalid('Invalid bounded rename inputs.');
  const locked = declarations.filter(row => key(row.ref) === key(target));
  if (locked.length !== 1) invalid('Exactly one admitted target declaration is required.');
  const declaration = locked[0];
  const bySource = new Map();
  let sourceBytes = 0;
  for (const source of sources) {
    let owned;
    try { owned = admitOwnedSemanticSourceSnapshot(source, { maxBytes: maxSourceBytes, repositoryNamespace: world.repositoryNamespace }); }
    catch { invalid('Stale or incompatible source snapshot.'); }
    const manifest = owned.manifest;
    if (bySource.has(manifest.sourceUnitId)) invalid('Stale or incompatible source snapshot.');
    sourceBytes += owned.byteLength;
    if (sourceBytes > maxSourceBytes) invalid('Source overlay allowance exceeded.');
    bySource.set(manifest.sourceUnitId, { manifest, ...owned });
  }
  const validateSite = (site, spelling) => {
    const source = bySource.get(site?.sourceUnitId);
    if (!source || !Array.isArray(site.span) || site.span.length !== 2
      || site.span.some(offset => !Number.isSafeInteger(offset) || offset < 0)
      || site.span[1] < site.span[0] || site.span[1] > source.text.length
      || !site.span.every(offset => boundary(source.text, offset))
      || source.text.slice(...site.span) !== spelling) invalid('Source span does not match admitted spelling.');
  };
  validateSite(declarationSite, declaration.datumKey);
  const seen = new Set();
  for (const occurrence of occurrences) {
    const id = key(occurrence.query.occurrence);
    if (seen.has(id)) invalid('Duplicate preservation occurrence.');
    seen.add(id);
    validateSite(occurrence.site, occurrence.query.datumKey);
  }
  const base = { world, profile, scopes, declarations, maxVisits, maxCandidates, maxWitnessRefs, signal };
  const checks = [];
  const frontier = [];
  let retainedEvidenceBytes = 0, evidenceExhausted = false;
  const retain = value => {
    const bytes = Buffer.byteLength(key(value));
    if (retainedEvidenceBytes + bytes > maxEvidenceBytes) {
      if (!evidenceExhausted) frontier.push({ reason: 'evidence-byte-budget' });
      evidenceExhausted = true; return false;
    }
    retainedEvidenceBytes += bytes; return true;
  };
  let workQueries = 0;
  for (const occurrence of occurrences) {
    if (signal?.aborted || workQueries >= maxQueries) {
      frontier.push({ reason: signal?.aborted ? 'cancelled' : 'query-budget', occurrence: occurrence.query.occurrence });
      break;
    }
    const before = resolveLexicalBinding({ ...base, query: occurrence.query });
    workQueries++;
    if (!retain(before)) break;
    const editsTarget = before.completeInProfile && before.status === 'resolved'
      && key(before.targets[0]) === key(target);
    checks.push({ occurrence, before, editsTarget });
    if (!before.completeInProfile) frontier.push({ reason: 'base-binding-unknown', occurrence: occurrence.query.occurrence });
  }
  const edits = [{ sourceUnitId: declarationSite.sourceUnitId, span: [...declarationSite.span],
    expectedText: declaration.datumKey, replacement: newName, reason: 'explicit-declaration-rename' }];
  for (const check of checks.filter(row => row.editsTarget)) edits.push({
    sourceUnitId: check.occurrence.site.sourceUnitId, span: [...check.occurrence.site.span],
    expectedText: check.occurrence.query.datumKey, replacement: newName, reason: 'locked-reference-rename'
  });
  const overlays = [];
  let overlayBytes = 0;
  for (const [sourceUnitId, source] of bySource) {
    const selected = edits.filter(edit => edit.sourceUnitId === sourceUnitId).sort((a, b) => a.span[0] - b.span[0]);
    for (let index = 1; index < selected.length; index++) {
      if (selected[index].span[0] < selected[index - 1].span[1]) invalid('Overlapping rename edits.');
    }
    let text = source.text;
    for (const edit of [...selected].reverse()) text = text.slice(0, edit.span[0]) + edit.replacement + text.slice(edit.span[1]);
    overlayBytes += Buffer.byteLength(text);
    if (overlayBytes > maxSourceBytes) invalid('Expanded source overlay allowance exceeded.');
    const snapshot = createSemanticSourceSnapshot({ bytes: Buffer.from(text),
      repositoryNamespace: source.manifest.repositoryNamespace, path: source.manifest.path,
      language: source.manifest.language, dialect: source.manifest.dialect, mapping: source.manifest.mapping });
    overlays.push({ beforeSourceUnitId: sourceUnitId, manifest: snapshot.manifest, text: snapshot.text });
  }
  const overlayId = semanticHash('pairofcleats.lexical-rename-overlay.v1', {
    world, profile, target, edits, sources: overlays.map(row => row.manifest.sourceUnitId)
  });
  const overlayWorld = { ...world, sourceSnapshotId: overlayId };
  const overlayDeclarations = declarations.map(row => key(row.ref) === key(target) ? { ...row, datumKey: newName } : row);
  let declarationCheck = null;
  if (!signal?.aborted && !evidenceExhausted && workQueries < maxQueries) {
    declarationCheck = resolveLexicalBinding({ ...base, world: overlayWorld, declarations: overlayDeclarations,
      query: { occurrence: target, startScope: declaration.scope, namespace: declaration.namespace, datumKey: newName } });
    workQueries++;
    if (!retain(declarationCheck)) declarationCheck = null;
    else if (!declarationCheck.completeInProfile) frontier.push({ reason: 'declaration-binding-unknown' });
  } else if (!evidenceExhausted) frontier.push({ reason: signal?.aborted ? 'cancelled' : 'query-budget' });
  const preservation = [];
  for (const check of checks) {
    if (evidenceExhausted) break;
    if (signal?.aborted || workQueries >= maxQueries) {
      frontier.push({ reason: signal?.aborted ? 'cancelled' : 'query-budget', occurrence: check.occurrence.query.occurrence });
      break;
    }
    const after = resolveLexicalBinding({ ...base, world: overlayWorld, declarations: overlayDeclarations,
      query: check.editsTarget ? { ...check.occurrence.query, datumKey: newName } : check.occurrence.query });
    workQueries++;
    if (!retain(after)) break;
    const status = !check.before.completeInProfile || !after.completeInProfile ? 'unknown'
      : sameTargets(check.before, after) ? 'preserved' : 'changed';
    preservation.push({ occurrence: structuredClone(check.occurrence.query.occurrence), edited: check.editsTarget,
      status, before: check.before, after });
    if (status === 'unknown') frontier.push({ reason: 'overlay-binding-unknown', occurrence: check.occurrence.query.occurrence });
  }
  if (referenceUniverse?.state !== 'complete-in-model' || !referenceUniverse.receiptId) {
    frontier.push({ reason: 'affected-reference-universe-incomplete' });
  }
  const changed = preservation.some(row => row.status === 'changed') || declarationCheck?.completeInProfile
    && (declarationCheck.status !== 'resolved' || key(declarationCheck.targets[0]) !== key(target));
  return {
    schemaVersion: 1, intent: 'rename', baseWorld: structuredClone(world), overlayWorld, overlayId,
    lockedTarget: structuredClone(target), targetCorrespondence: { kind: 'same-lexical-scope',
      before: structuredClone(target), afterProposalLocal: structuredClone(target) },
    edits, overlays, preservation, declarationCheck, frontier, workQueries, retainedEvidenceBytes, sourceBytes, overlayBytes,
    bindingPreservation: changed ? 'refuted-in-model' : frontier.length ? 'unknown' : 'preserved-in-model',
    syntaxValidity: 'not-checked', nativeValidation: 'not-run', behaviorPreservation: 'not-claimed',
    authority: 'inert-proposal', applySupported: false
  };
};
