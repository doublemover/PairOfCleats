import { createHash } from 'node:crypto';
import { semanticHash } from './identity.js';
import { throwIfAborted } from '../../shared/abort.js';

const MAX_BODY_UNITS = 1048576;
const MAX_LOCATOR_DEPTH = 64;
const digestRange = (text, start, end, signal) => {
  const hash = createHash('sha256');
  for (let offset = start; offset < end;) {
    throwIfAborted(signal);
    let next = Math.min(end, offset + 4096);
    if (next < end && text.charCodeAt(next - 1) >= 0xd800 && text.charCodeAt(next - 1) <= 0xdbff
      && text.charCodeAt(next) >= 0xdc00 && text.charCodeAt(next) <= 0xdfff) next--;
    hash.update(text.slice(offset, next), 'utf8'); offset = next;
  }
  return hash.digest('hex');
};

/** A named lexical locator is a comparison key, never cross-edit authority.
 * Duplicate locators remain ambiguous instead of selecting the first overload.
 */
export const createCompilerSummarySourceIdentities = ({ ts, sourceFile, source, summaries, signal = null }) => {
  const result = new WeakMap(), locators = new Map();
  let remaining = MAX_BODY_UNITS;
  if (sourceFile.text.length > 64 * 1024 * 1024 || source.textLength !== sourceFile.text.length
    || digestRange(sourceFile.text, 0, sourceFile.text.length, signal) !== source.textHash) return result;
  for (const summary of summaries) {
    throwIfAborted(signal);
    const owner = summary.owner;
    if (!owner || !summary.declaration) continue;
    const start = owner.getStart(sourceFile), end = owner.end, bodyStart = owner.body?.getStart(sourceFile) ?? start;
    const fail = reason => result.set(owner, Object.freeze({ status: 'unavailable', reason }));
    if (start < 0 || bodyStart < start || end < bodyStart || end > sourceFile.text.length
      || end - start > remaining) { fail('summary_body_identity_budget_or_range'); continue; }
    remaining -= end - start;
    const lexical = [];
    let node = owner, valid = true;
    while (node && node !== sourceFile) {
      if (lexical.length === MAX_LOCATOR_DEPTH) { valid = false; break; }
      if (ts.isFunctionLike(node) || ts.isClassLike(node)) {
        const named = node.name || (node.parent && ts.isVariableDeclaration(node.parent) && node.parent.initializer === node ? node.parent.name : null);
        if (!named || !ts.isIdentifier(named) && !ts.isStringLiteral(named) && !ts.isPrivateIdentifier(named)) { valid = false; break; }
        if (named.text.length > 256) { valid = false; break; }
        lexical.push({ kind: ts.SyntaxKind[node.kind], name: named.text });
      }
      node = node.parent;
    }
    const bodyHash = digestRange(sourceFile.text, bodyStart, end, signal);
    const headerHash = digestRange(sourceFile.text, start, bodyStart, signal);
    const locator = valid ? { path: source.path, language: source.language, mappingIdentity: source.mapping?.identity || null,
      lexical: lexical.reverse(), headerHash } : null;
    const locatorHash = locator ? semanticHash('semantic.summary-locator.v1', locator, { maxBytes: 65536 }) : null;
    const value = { status: valid ? 'qualified-for-comparison' : 'body-only',
      reason: valid ? null : 'anonymous_or_computed_lexical_locator_unqualified', sourceUnitId: source.sourceUnitId,
      sourceHash: source.byteHash, span: [start, end], bodySpan: [bodyStart, end], bodyHash, headerHash, locator, locatorHash };
    result.set(owner, value);
    if (locatorHash) {
      if (!locators.has(locatorHash)) locators.set(locatorHash, []);
      locators.get(locatorHash).push(value);
    }
  }
  for (const matches of locators.values()) if (matches.length > 1) for (const value of matches) {
    value.status = 'ambiguous'; value.reason = 'duplicate_named_declaration_locator';
  }
  for (const summary of summaries) if (summary.owner && result.has(summary.owner)) {
    const value = result.get(summary.owner);
    if (value.locator) { value.locator.lexical.forEach(Object.freeze); Object.freeze(value.locator.lexical); Object.freeze(value.locator); }
    if (value.span) Object.freeze(value.span);
    if (value.bodySpan) Object.freeze(value.bodySpan);
    Object.freeze(value);
  }
  return result;
};
