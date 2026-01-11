export const collectRazorImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*@using\s+(.+)$/i);
    if (match) imports.push(match[1].trim());
  }
  return imports;
};
