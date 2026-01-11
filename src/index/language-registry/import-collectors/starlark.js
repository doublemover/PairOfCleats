export const collectStarlarkImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    if (line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*load\s*\(\s*['"]([^'"]+)['"]/);
    if (match) imports.push(match[1]);
  }
  return imports;
};
