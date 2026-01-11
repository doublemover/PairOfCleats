export const collectJinjaImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/{%\s*(?:extends|include|import)\s+['"]([^'"]+)['"]/);
    if (match) imports.push(match[1]);
  }
  return imports;
};
