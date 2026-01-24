export const detectFrontmatter = (text) => {
  if (!text) return null;
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') lineStarts.push(i + 1);
  }
  if (!lineStarts.length) return null;
  const getLine = (index) => {
    if (index < 0 || index >= lineStarts.length) return null;
    const start = lineStarts[index];
    const end = index + 1 < lineStarts.length ? lineStarts[index + 1] - 1 : text.length;
    return { start, end, raw: text.slice(start, end) };
  };
  const firstLine = getLine(0);
  if (!firstLine) return null;
  const fence = firstLine.raw.trim();
  if (fence !== '---' && fence !== '+++' && fence !== ';;;') return null;
  let endIndex = -1;
  for (let i = 1; i < lineStarts.length; i += 1) {
    const line = getLine(i);
    if (!line) continue;
    if (line.raw.trim() === fence) {
      endIndex = i;
      break;
    }
  }
  if (endIndex <= 0) return null;
  const endLine = getLine(endIndex);
  const startOffset = Math.max(0, firstLine.start);
  const endOffset = Math.max(0, (endLine?.start ?? 0) + (endLine?.raw?.length ?? 0));
  const languageId = fence === '---' ? 'yaml' : (fence === '+++' ? 'toml' : 'json');
  const rawLines = [];
  for (let i = 1; i < endIndex; i += 1) {
    const line = getLine(i);
    if (line) rawLines.push(line.raw.replace(/\r$/, ''));
  }
  return {
    fence,
    languageId,
    start: startOffset,
    end: endOffset,
    startOffset,
    endOffset,
    raw: rawLines.join('\n')
  };
};
