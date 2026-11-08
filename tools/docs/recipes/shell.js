/** Tokenize documented argv only. No expansion, redirection, subprocess or evaluation. */
export const tokenizeRecipeCommands = (source, { shell = 'portable' } = {}) => {
  if (!['portable', 'posix', 'powershell'].includes(shell)) throw new Error('Unknown recipe shell.');
  const text = source.replace(/\\\r?\n|`\r?\n/g, ' ');
  const commands = [];
  let tokens = [];
  let token = '';
  let quote = null;
  let started = false;
  const finishToken = () => { if (started) tokens.push(token); token = ''; started = false; };
  const finishCommand = () => { finishToken(); if (tokens.length) commands.push(tokens); tokens = []; };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === quote) {
        if (shell === 'powershell' && quote === "'" && text[index + 1] === "'") { token += "'"; index++; }
        else quote = null;
      } else if (char === '`' && shell === 'powershell' && quote === '"') token += text[++index] || '';
      else if (char === '\\' && quote === '"' && /["\\$`]/.test(text[index + 1] || '')) token += text[++index];
      else token += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; started = true; continue; }
    if (char === '\n' || char === '\r') { finishCommand(); continue; }
    if (/\s/.test(char)) { finishToken(); continue; }
    if (char === '#' && !started) { while (index < text.length && text[index] !== '\n') index++; finishCommand(); continue; }
    if ([';', '|', '&'].includes(char) || char === '`' || (char === '$' && text[index + 1] === '(')) throw new Error('Executable shell composition/expansion is not admitted in an argv recipe.');
    // Named <placeholders> are literal documentation values, not shell redirects.
    if ((char === '<' || char === '>') && !(char === '<' && /^<[A-Za-z][A-Za-z0-9_.-]*>/.test(text.slice(index)))) {
      if (char === '>' && token.startsWith('<')) { token += char; continue; }
      throw new Error('Redirection belongs to an explicitly classified shell step, not an argv recipe.');
    }
    token += char;
    started = true;
  }
  if (quote) throw new Error('Unterminated quoted recipe token.');
  finishCommand();
  return commands;
};
