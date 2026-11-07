/** Ruby LSP presentation only. This intentionally does not infer type structure
 * or reuse Solargraph's YARD/type conventions as protocol equivalence. */
export const parseRubyLspSignature = detail => {
  if (typeof detail !== 'string' || detail.length > 16384) return null;
  const lines = detail.split(/\r?\n/u);
  for (const line of lines) {
    const candidate = line.trim();
    if (/^(?:private\s+|protected\s+|public\s+)?def\s+(?:self\.)?[^\s(]+(?:\s*\([^\n]*\))?\s*$/u.test(candidate)) {
      return { signature: candidate.slice(0, 512) };
    }
  }
  return null;
};
parseRubyLspSignature.cacheKey = 'ruby-lsp-presentation-v1';
