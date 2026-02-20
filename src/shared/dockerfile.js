const toInstructionTokens = (line) => (
  String(line || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
);

export const parseDockerfileInstruction = (line) => {
  const tokens = toInstructionTokens(line);
  if (!tokens.length) return null;
  const instruction = String(tokens[0] || '').toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]*$/.test(instruction)) return null;
  return {
    instruction,
    tokens,
    args: tokens.slice(1)
  };
};

export const parseDockerfileFromClause = (line) => {
  const parsed = parseDockerfileInstruction(line);
  if (!parsed || parsed.instruction !== 'FROM') return null;
  const args = parsed.args || [];
  let index = 0;
  while (index < args.length && String(args[index]).startsWith('--')) {
    index += 1;
  }
  const image = args[index] || '';
  let stage = '';
  for (let i = index + 1; i < args.length - 1; i += 1) {
    if (String(args[i]).toUpperCase() !== 'AS') continue;
    stage = args[i + 1] || '';
    break;
  }
  return {
    image: String(image || ''),
    stage: String(stage || ''),
    instruction: parsed.instruction
  };
};
