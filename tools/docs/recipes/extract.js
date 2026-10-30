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
    const allowed = new Set(['kind', 'shell', 'effects', 'classification', 'enclosing', 'authority', 'normalization', 'prerequisites', 'platforms', 'targets', 'expected']);
    if (Object.keys(metadata).some(key => !allowed.has(key))) throw new Error(`${sourcePath}:${index + 1}: recipe ${marker[1]} has unknown metadata.`);
    if (metadata.classification && !['current', 'historical', 'proposal', 'pseudocode', 'api-fragment'].includes(metadata.classification)) throw new Error(`${sourcePath}:${index + 1}: recipe ${marker[1]} has an unknown classification.`);
    if (metadata.kind && !['command', 'config'].includes(metadata.kind)) throw new Error(`${sourcePath}:${index + 1}: recipe ${marker[1]} has an unknown snippet kind.`);
    if (metadata.targets && !['single', 'multiple'].includes(metadata.targets)) throw new Error(`${sourcePath}:${index + 1}: recipe ${marker[1]} has an unknown target-identity policy.`);
    let begin = index + 1;
    while (begin < lines.length && !lines[begin].trim()) begin++;
    const fence = /^```([a-z0-9-]*)$/.exec(lines[begin] || '');
    if (!fence) throw new Error(`${sourcePath}:${begin + 1}: recipe ${marker[1]} must immediately precede a fenced snippet.`);
    let end = begin + 1;
    while (end < lines.length && lines[end] !== '```') end++;
    if (end >= lines.length) throw new Error(`${sourcePath}:${begin + 1}: unterminated recipe ${marker[1]}.`);
    recipes.push({ id: marker[1], sourcePath, line: begin + 2, language: fence[1],
      kind: metadata.kind || 'command', shell: metadata.shell || 'portable', effects: metadata.effects || 'unspecified',
      enclosing: metadata.enclosing || null, authority: metadata.authority || 'effective', normalization: metadata.normalization || 'exact',
      prerequisites: metadata.prerequisites?.split(',').filter(Boolean) || [], platforms: metadata.platforms?.split(',').filter(Boolean) || ['unqualified'],
      targets: metadata.targets || 'single', expected: metadata.expected || 'unspecified',
      classification: metadata.classification || 'current', content: lines.slice(begin + 1, end).join('\n') });
    index = end;
  }
  return recipes;
};

/** Inventory unmarked fences explicitly; absence of an opted-in recipe is not
 * evidence that its command/config/API fragment passed any contract check.
 */
export const inventoryAuthoredRecipeFences = (text, recipes) => {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const byLine = new Map(recipes.map(recipe => [recipe.line - 1, recipe]));
  const fences = [];
  let inFence = false;
  for (let index = 0; index < lines.length; index++) {
    const fence = /^```([a-zA-Z0-9-]*)$/.exec(lines[index]);
    if (!fence) continue;
    if (inFence) { inFence = false; continue; }
    const recipe = byLine.get(index + 1);
    fences.push({ line: index + 1, language: fence[1], recipeId: recipe?.id || null,
      classification: recipe?.classification || 'unmarked-unqualified' });
    inFence = true;
  }
  return fences;
};
