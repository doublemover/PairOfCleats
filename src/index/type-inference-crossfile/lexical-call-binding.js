const rootName = callee => typeof callee === 'string' ? callee.split(/::|\./u)[0] : null;
const proofFor = detail => {
  const proof = detail?.lexicalBinding;
  return proof?.v === 1 && typeof proof.root === 'string' && proof.root.length > 0
    && proof.root === rootName(detail?.callee) ? proof : null;
};
export const isShadowedImportCall = detail => {
  const proof = proofFor(detail);
  return proof?.kind === 'local' && proof.shadowsImport === true;
};
export const unresolvedShadowedImport = targetName => ({ v: 1, targetName, kindHint: null,
  importHint: null, candidates: [], status: 'unresolved', resolved: null, reason: 'lexical-import-shadow' });

/** A name-only edge may retain an import target only when an actual unshadowed
 * import occurrence witnesses it. Detail summaries retain their own decisions. */
export const collectShadowedImportCallees = details => {
  const shadowed = new Set(), imported = new Set();
  for (const detail of Array.isArray(details) ? details : []) {
    if (isShadowedImportCall(detail)) shadowed.add(detail.callee);
    const proof = proofFor(detail);
    if (proof?.kind === 'import' && proof.shadowsImport === false) imported.add(detail.callee);
  }
  return { all: shadowed, only: new Set([...shadowed].filter(name => !imported.has(name))) };
};
