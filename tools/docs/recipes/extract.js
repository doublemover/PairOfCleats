/** Only explicitly marked current snippets are admitted; arbitrary Markdown is never executed. */
export const extractAuthoredRecipes = (text, sourcePath) => {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const recipes = [];
  let inFence = false;
  for (let index = 0; index < lines.length; index++) {
    if (/^```/.test(lines[index])) { inFence = !inFence; continue; }
    if (inFence) continue;
    const marker = /^<!-- poc:recipe ([a-z0-9][a-z0-9.-]*)(.*?) -->$/.exec(lines[index]);
    if (!marker) continue;
    const metadata = Object.fromEntries([...marker[2].matchAll(/([a-z-]+)=([^\s]+)/g)].map(match => [match[1], match[2]]));
    let begin = index + 1;
    while (begin < lines.length && !lines[begin].trim()) begin++;
    const fence = /^```([a-z0-9-]*)$/.exec(lines[begin] || '');
    if (!fence) throw new Error(`${sourcePath}:${begin + 1}: recipe ${marker[1]} must immediately precede a fenced snippet.`);
    let end = begin + 1;
    while (end < lines.length && lines[end] !== '```') end++;
    if (end >= lines.length) throw new Error(`${sourcePath}:${begin + 1}: unterminated recipe ${marker[1]}.`);
    recipes.push({ id: marker[1], sourcePath, line: begin + 2, language: fence[1],
      kind: metadata.kind || 'command', shell: metadata.shell || 'portable', effects: metadata.effects || 'unspecified',
      classification: metadata.classification || 'current', content: lines.slice(begin + 1, end).join('\n') });
    index = end;
  }
  return recipes;
};
