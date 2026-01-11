export const collectProtoImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*import\s+(?:public\s+)?\"([^\"]+)\"/);
    if (match) imports.push(match[1]);
  }
  return imports;
};
