import { DISPATCH_BY_PATH, commandPathKey } from './registry.js';

const asTokens = (argv) => (Array.isArray(argv) ? argv.map((entry) => String(entry)) : []);

const matchEntry = (tokens) => {
  if (!tokens.length) return null;
  if (tokens.length >= 2) {
    const twoKey = commandPathKey(tokens.slice(0, 2));
    if (DISPATCH_BY_PATH[twoKey]) {
      return {
        entry: DISPATCH_BY_PATH[twoKey],
        commandPath: tokens.slice(0, 2),
        rest: tokens.slice(2)
      };
    }
  }
  const oneKey = commandPathKey(tokens.slice(0, 1));
  if (DISPATCH_BY_PATH[oneKey]) {
    return {
      entry: DISPATCH_BY_PATH[oneKey],
      commandPath: tokens.slice(0, 1),
      rest: tokens.slice(1)
    };
  }
  return null;
};

export const resolveDispatchRequest = (argv) => {
  const tokens = asTokens(argv);
  const match = matchEntry(tokens);
  if (!match) return null;
  return {
    id: match.entry.id,
    commandPath: match.commandPath,
    script: match.entry.script,
    args: match.rest,
    entry: match.entry
  };
};
