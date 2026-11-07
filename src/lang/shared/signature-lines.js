import { findDeclarationBoundary } from './declaration-boundary.js';
/** Zero-based start/end line indexes; a bounded preview plus real body offset. */
export function readSignatureLines(lines, startLine, options = {}) {
  const text = lines.slice(startLine, startLine + 256).join('\n');
  const boundary = findDeclarationBoundary(text, 0, options);
  const endOffset = boundary.bodyStart >= 0 ? boundary.bodyStart + 1 : boundary.signatureEnd;
  const consumed = text.slice(0, endOffset);
  return { signature: consumed.replace(/\s+/g, ' ').trim(),
    endLine: startLine + (consumed.match(/\n/g) || []).length,
    hasBody: boundary.bodyStart >= 0, bodyOffset: boundary.bodyStart, capped: boundary.capped };
}
