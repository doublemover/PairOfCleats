export function cleanContext(lines) {
  return lines
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '```') return false;
      if (!/[a-zA-Z0-9]/.test(trimmed)) return false;
      return true;
    })
    .map((line) => line.replace(/\s+/g, ' ').trim());
}
