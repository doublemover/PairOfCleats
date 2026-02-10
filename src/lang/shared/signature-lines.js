export function readSignatureLines(lines, startLine, { stopOnSemicolon = true } = {}) {
  const parts = [];
  let hasBrace = false;
  let hasSemi = false;
  let endLine = startLine;

  for (let i = startLine; i < lines.length; i += 1) {
    const line = lines[i];
    parts.push(line.trim());
    if (line.includes('{')) {
      hasBrace = true;
      endLine = i;
      break;
    }
    if (stopOnSemicolon && line.includes(';')) {
      hasSemi = true;
      endLine = i;
      break;
    }
    endLine = i;
  }

  const signature = parts.join(' ');
  if (!stopOnSemicolon) {
    return { signature, endLine, hasBody: hasBrace };
  }
  const braceIdx = signature.indexOf('{');
  const semiIdx = signature.indexOf(';');
  const hasBody = hasBrace && (semiIdx === -1 || (braceIdx !== -1 && braceIdx < semiIdx));
  return { signature, endLine, hasBody };
}
