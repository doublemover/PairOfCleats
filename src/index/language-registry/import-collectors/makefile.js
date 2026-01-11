export const collectMakefileImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const trimmed = line.replace(/#.*$/, '').trim();
    const match = trimmed.match(/^\s*-?include\s+(.+)$/i);
    if (!match) continue;
    const parts = match[1].split(/\s+/).filter(Boolean);
    imports.push(...parts);
  }
  return imports;
};
