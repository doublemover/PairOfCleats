const toInstructionTokens = (line) => (
  String(line || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
);

const DOCKERFILE_INSTRUCTIONS = new Set([
  'ADD',
  'ARG',
  'CMD',
  'COPY',
  'ENTRYPOINT',
  'ENV',
  'EXPOSE',
  'FROM',
  'HEALTHCHECK',
  'LABEL',
  'MAINTAINER',
  'ONBUILD',
  'RUN',
  'SHELL',
  'STOPSIGNAL',
  'USER',
  'VOLUME',
  'WORKDIR'
]);

export const parseDockerfileInstruction = (line) => {
  const tokens = toInstructionTokens(line);
  if (!tokens.length) return null;
  const instruction = String(tokens[0] || '').toUpperCase();
  if (!DOCKERFILE_INSTRUCTIONS.has(instruction)) return null;
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
  const skipOption = (startIndex) => {
    const option = String(args[startIndex] || '');
    if (!option.startsWith('--')) return startIndex;
    const next = String(args[startIndex + 1] || '');
    const hasInlineAssignment = option.includes('=');
    if (hasInlineAssignment) {
      const [, inlineValue = ''] = option.split(/=(.*)/, 2);
      if (!inlineValue && next && next.toUpperCase() !== 'AS' && !next.startsWith('--')) {
        return startIndex + 2;
      }
      return startIndex + 1;
    }
    if (next === '=') return startIndex + 3;
    if (next && next.toUpperCase() !== 'AS' && !next.startsWith('--')) return startIndex + 2;
    return startIndex + 1;
  };

  let index = 0;
  while (index < args.length && String(args[index]).startsWith('--')) {
    const nextIndex = skipOption(index);
    if (nextIndex <= index) break;
    index = nextIndex;
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
