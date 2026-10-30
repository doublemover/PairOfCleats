import { decodeRArgumentToken } from './r-literals.js';

const packageFormals = Object.freeze({
  library: Object.freeze(['package', 'help', 'pos', 'lib.loc', 'character.only', 'logical.return',
    'warn.conflicts', 'quietly', 'verbose', 'mask.ok', 'exclude', 'include.only', 'attach.required']),
  require: Object.freeze(['package', 'lib.loc', 'quietly', 'warn.conflicts', 'character.only',
    'mask.ok', 'exclude', 'include.only', 'attach.required'])
});

/** Only the bare or explicitly base-qualified built-ins are supported here. */
export const isSupportedRDependencyCall = (tokens, index) => {
  const previous = tokens[index - 1]?.value;
  if (previous === '$' || previous === '@') return false;
  if (previous !== ':') return true;
  let start = index - 1;
  while (start >= 0 && tokens[start].value === ':') start--;
  const count = index - start - 1;
  return (count === 2 || count === 3) && tokens[start]?.kind === 'identifier' && tokens[start].value === 'base'
    && !['$', '@', ':'].includes(tokens[start - 1]?.value);
};

/** R matches exact names, unique partial names, then unnamed positions. */
export const bindRPackageArguments = (name, args, source) => {
  const formals = packageFormals[name];
  if (!formals) return null;
  const bindings = new Map(), partial = [], positional = [];
  for (const arg of args) {
    if (arg[1]?.value !== '=') { positional.push(arg); continue; }
    const key = decodeRArgumentToken(arg[0], source)?.value;
    if (!key) return null;
    if (!formals.includes(key)) { partial.push({ key, value: arg.slice(2) }); continue; }
    if (bindings.has(key)) return null;
    bindings.set(key, arg.slice(2));
  }
  const exact = new Set(bindings.keys());
  for (const argument of partial) {
    const candidates = formals.filter(formal => !exact.has(formal) && formal.startsWith(argument.key));
    if (candidates.length !== 1 || bindings.has(candidates[0])) return null;
    bindings.set(candidates[0], argument.value);
  }
  let next = 0;
  for (const argument of positional) {
    while (next < formals.length && bindings.has(formals[next])) next++;
    if (next === formals.length) return null;
    bindings.set(formals[next++], argument);
  }
  return bindings;
};
