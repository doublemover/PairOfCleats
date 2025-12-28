import fs from 'node:fs';
import path from 'node:path';

/**
 * Filter chunk metadata by search constraints.
 * @param {Array} meta
 * @param {object} filters
 * @returns {Array}
 */
export function filterChunks(meta, filters = {}) {
  const {
    type,
    author,
    call,
    importName,
    lint,
    churn,
    calls,
    uses,
    signature,
    param,
    decorator,
    returnType,
    throws,
    reads,
    writes,
    mutates,
    awaits,
    visibility,
    extends: extendsFilter,
    async: asyncOnly,
    generator: generatorOnly,
    returns: returnsOnly
  } = filters;
  const normalize = (value) => String(value || '').toLowerCase();
  const matchList = (list, value) => {
    if (!value) return true;
    if (!Array.isArray(list)) return false;
    const needle = normalize(value);
    return list.some((entry) => normalize(entry).includes(needle));
  };
  const truthy = (value) => value === true;

  return meta.filter((c) => {
    if (!c) return false;
    if (type && c.kind && c.kind.toLowerCase() !== type.toLowerCase()) return false;
    if (author && c.last_author && !c.last_author.toLowerCase().includes(author.toLowerCase())) return false;
    if (call && c.codeRelations && c.codeRelations.calls) {
      const found = c.codeRelations.calls.find(([fn, callName]) => callName === call || fn === call);
      if (!found) return false;
    }
    if (importName && c.codeRelations && c.codeRelations.imports) {
      if (!c.codeRelations.imports.includes(importName)) return false;
    }
    if (lint && (!c.lint || !c.lint.length)) return false;
    if (churn && (!c.churn || c.churn < churn)) return false;
    if (calls && c.codeRelations && c.codeRelations.calls) {
      const found = c.codeRelations.calls.find(([fn, callName]) => fn === calls || callName === calls);
      if (!found) return false;
    }
    if (uses && c.codeRelations && c.codeRelations.usages) {
      if (!c.codeRelations.usages.includes(uses)) return false;
    }
    if (signature && c.docmeta?.signature) {
      if (!c.docmeta.signature.includes(signature)) return false;
    }
    if (param && c.docmeta?.params) {
      if (!c.docmeta.params.includes(param)) return false;
    }
    if (decorator && !matchList(c.docmeta?.decorators, decorator)) return false;
    if (returnType) {
      const foundReturnType = c.docmeta?.returnType || null;
      if (!foundReturnType || !normalize(foundReturnType).includes(normalize(returnType))) {
        return false;
      }
    }
    if (throws && !matchList(c.docmeta?.throws, throws)) return false;
    if (awaits && !matchList(c.docmeta?.awaits, awaits)) return false;
    if (reads && !matchList(c.docmeta?.dataflow?.reads, reads)) return false;
    if (writes && !matchList(c.docmeta?.dataflow?.writes, writes)) return false;
    if (mutates && !matchList(c.docmeta?.dataflow?.mutations, mutates)) return false;
    if (visibility) {
      const docVisibility = c.docmeta?.visibility || c.docmeta?.modifiers?.visibility || null;
      if (!docVisibility || !normalize(docVisibility).includes(normalize(visibility))) {
        return false;
      }
    }
    if (extendsFilter) {
      const parents = c.docmeta?.extends || c.docmeta?.bases || [];
      if (!matchList(parents, extendsFilter)) return false;
    }
    if (truthy(asyncOnly)) {
      if (!(c.docmeta?.async || c.docmeta?.modifiers?.async)) return false;
    }
    if (truthy(generatorOnly)) {
      if (!(c.docmeta?.modifiers?.generator || c.docmeta?.yields)) return false;
    }
    if (truthy(returnsOnly)) {
      if (!(c.docmeta?.returnsValue || c.docmeta?.returns)) return false;
    }
    return true;
  });
}

/**
 * Normalize context lines for display.
 * @param {string[]} lines
 * @returns {string[]}
 */
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

function getBodySummary(rootDir, chunk, maxWords = 80) {
  try {
    const absPath = path.join(rootDir, chunk.file);
    const text = fs.readFileSync(absPath, 'utf8');
    const chunkText = text.slice(chunk.start, chunk.end)
      .replace(/\s+/g, ' ')
      .trim();
    const words = chunkText.split(/\s+/).slice(0, maxWords).join(' ');
    return words;
  } catch {
    return '(Could not load summary)';
  }
}

/**
 * Render a full, human-readable result entry.
 * @param {object} options
 * @returns {string}
 */
export function formatFullChunk({
  chunk,
  index,
  mode,
  annScore,
  color,
  queryTokens = [],
  rx,
  matched = false,
  rootDir,
  summaryState
}) {
  if (!chunk || !chunk.file) {
    return color.red(`   ${index + 1}. [Invalid result - missing chunk or file]`) + '\n';
  }
  const c = color;
  let out = '';

  const line1 = [
    c.bold(c[mode === 'code' ? 'blue' : 'magenta'](`${index + 1}. ${chunk.file}`)),
    c.cyan(chunk.name || ''),
    c.yellow(chunk.kind || ''),
    c.green(`${annScore.toFixed(2)}`),
    c.gray(`Start/End: ${chunk.start}/${chunk.end}`),
    (chunk.startLine && chunk.endLine)
      ? c.gray(`Lines: ${chunk.startLine}-${chunk.endLine}`)
      : '',
    typeof chunk.churn === 'number' ? c.yellow(`Churn: ${chunk.churn}`) : ''
  ].filter(Boolean).join('  ');

  out += line1 + '\n';

  const headlinePart = chunk.headline ? c.bold('Headline: ') + c.underline(chunk.headline) : '';
  const lastModPart = chunk.last_modified ? c.gray('Last Modified: ') + c.bold(chunk.last_modified) : '';
  const secondLine = [headlinePart, lastModPart].filter(Boolean).join('   ');
  if (secondLine) out += '   ' + secondLine + '\n';

  if (chunk.last_author && chunk.last_author !== '2xmvr') {
    out += c.gray('   Last Author: ') + c.green(chunk.last_author) + '\n';
  }

  if (chunk.imports?.length) {
    out += c.magenta('   Imports: ') + chunk.imports.join(', ') + '\n';
  } else if (chunk.codeRelations?.imports?.length) {
    out += c.magenta('   Imports: ') + chunk.codeRelations.imports.join(', ') + '\n';
  }

  if (chunk.exports?.length) {
    out += c.blue('   Exports: ') + chunk.exports.join(', ') + '\n';
  } else if (chunk.codeRelations?.exports?.length) {
    out += c.blue('   Exports: ') + chunk.codeRelations.exports.join(', ') + '\n';
  }

  if (chunk.codeRelations?.calls?.length) {
    out += c.yellow('   Calls: ') + chunk.codeRelations.calls.map(([a, b]) => `${a}->${b}`).join(', ') + '\n';
  }

  if (chunk.codeRelations?.importLinks?.length) {
    out += c.green('   ImportLinks: ') + chunk.codeRelations.importLinks.join(', ') + '\n';
  }

  if (chunk.codeRelations?.usages?.length) {
    const usageFreq = Object.create(null);
    chunk.codeRelations.usages.forEach((raw) => {
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      if (!trimmed) return;
      usageFreq[trimmed] = (usageFreq[trimmed] || 0) + 1;
    });

    const usageEntries = Object.entries(usageFreq).sort((a, b) => b[1] - a[1]);
    const maxCount = usageEntries[0]?.[1] || 0;

    const usageStr = usageEntries.slice(0, 10).map(([usage, count]) => {
      if (count === 1) return usage;
      if (count === maxCount) return c.bold(c.yellow(`${usage} (${count})`));
      return c.cyan(`${usage} (${count})`);
    }).join(', ');

    if (usageStr.length) out += c.cyan('   Usages: ') + usageStr + '\n';
  }

  const uniqueTokens = [...new Set((chunk.tokens || []).map((t) => t.trim()).filter((t) => t))];
  if (uniqueTokens.length) {
    out += c.magenta('   Tokens: ') + uniqueTokens.slice(0, 10).join(', ') + '\n';
  }

  if (matched && queryTokens.length) {
    const matchedTokens = queryTokens.filter((tok) =>
      (chunk.tokens && chunk.tokens.includes(tok)) ||
      (chunk.ngrams && chunk.ngrams.includes(tok)) ||
      (chunk.headline && chunk.headline.includes(tok))
    );
    if (matchedTokens.length) {
      out += c.gray('   Matched: ') + matchedTokens.join(', ') + '\n';
    }
  }

  if (chunk.docmeta?.signature) {
    out += c.cyan('   Signature: ') + chunk.docmeta.signature + '\n';
  }
  const modifiers = chunk.docmeta?.modifiers || null;
  const modifierParts = [];
  if (chunk.docmeta?.async || modifiers?.async) modifierParts.push('async');
  if (modifiers?.generator || chunk.docmeta?.yields) modifierParts.push('generator');
  if (modifiers?.static) modifierParts.push('static');
  const visibility = chunk.docmeta?.visibility || modifiers?.visibility || null;
  if (visibility) modifierParts.push(`visibility=${visibility}`);
  if (chunk.docmeta?.methodKind) modifierParts.push(`kind=${chunk.docmeta.methodKind}`);
  if (modifierParts.length) {
    out += c.gray('   Modifiers: ') + modifierParts.join(', ') + '\n';
  }
  if (chunk.docmeta?.decorators?.length) {
    out += c.magenta('   Decorators: ') + chunk.docmeta.decorators.join(', ') + '\n';
  }
  const bases = chunk.docmeta?.extends || chunk.docmeta?.bases || [];
  if (Array.isArray(bases) && bases.length) {
    out += c.magenta('   Extends: ') + bases.join(', ') + '\n';
  }
  if (chunk.docmeta?.returnType) {
    out += c.cyan('   Return Type: ') + chunk.docmeta.returnType + '\n';
  } else if (chunk.docmeta?.returnsValue) {
    out += c.cyan('   Returns: ') + 'value' + '\n';
  }
  if (chunk.docmeta?.throws?.length) {
    out += c.red('   Throws: ') + chunk.docmeta.throws.slice(0, 6).join(', ') + '\n';
  }
  if (chunk.docmeta?.awaits?.length) {
    out += c.blue('   Awaits: ') + chunk.docmeta.awaits.slice(0, 6).join(', ') + '\n';
  }
  if (chunk.docmeta?.yields) {
    out += c.blue('   Yields: ') + 'yes' + '\n';
  }
  const dataflow = chunk.docmeta?.dataflow || null;
  if (dataflow) {
    if (dataflow.reads?.length) {
      out += c.gray('   Reads: ') + dataflow.reads.slice(0, 6).join(', ') + '\n';
    }
    if (dataflow.writes?.length) {
      out += c.gray('   Writes: ') + dataflow.writes.slice(0, 6).join(', ') + '\n';
    }
    if (dataflow.mutations?.length) {
      out += c.gray('   Mutates: ') + dataflow.mutations.slice(0, 6).join(', ') + '\n';
    }
    if (dataflow.globals?.length) {
      out += c.gray('   Globals: ') + dataflow.globals.slice(0, 6).join(', ') + '\n';
    }
    if (dataflow.nonlocals?.length) {
      out += c.gray('   Nonlocals: ') + dataflow.nonlocals.slice(0, 6).join(', ') + '\n';
    }
  }

  if (chunk.lint?.length) {
    out += c.red(`   Lint: ${chunk.lint.length} issues`) +
      (chunk.lint.length ? c.gray(' | ') + chunk.lint.slice(0, 2).map((lintMsg) => JSON.stringify(lintMsg.message)).join(', ') : '') + '\n';
  }

  if (chunk.externalDocs?.length) {
    out += c.blue('   Docs: ') + chunk.externalDocs.join(', ') + '\n';
  }

  const cleanedPreContext = chunk.preContext ? cleanContext(chunk.preContext) : [];
  if (cleanedPreContext.length) {
    out += c.gray('   preContext: ') + cleanedPreContext.map((line) => c.green(line.trim())).join(' | ') + '\n';
  }

  const cleanedPostContext = chunk.postContext ? cleanContext(chunk.postContext) : [];
  if (cleanedPostContext.length) {
    out += c.gray('   postContext: ') + cleanedPostContext.map((line) => c.green(line.trim())).join(' | ') + '\n';
  }

  if (summaryState && rootDir) {
    if (index === 0) summaryState.lastCount = 0;
    if (index < 5) {
      let maxWords = 10;
      const lessPer = 3;
      maxWords -= (lessPer * index);
      const bodySummary = getBodySummary(rootDir, chunk, maxWords);
      if (summaryState.lastCount < maxWords) {
        maxWords = bodySummary.length;
      }
      summaryState.lastCount = bodySummary.length;
      out += c.gray('   Summary: ') + `${getBodySummary(rootDir, chunk, maxWords)}` + '\n';
    }
  }

  out += c.gray(''.padEnd(60, '-')) + '\n';
  return out;
}

/**
 * Render a compact, single-line result entry.
 * @param {object} options
 * @returns {string}
 */
export function formatShortChunk({
  chunk,
  index,
  mode,
  annScore,
  color,
  queryTokens = [],
  rx,
  matched = false
}) {
  if (!chunk || !chunk.file) {
    return color.red(`   ${index + 1}. [Invalid result - missing chunk or file]`) + '\n';
  }
  let out = '';
  out += `${color.bold(color[mode === 'code' ? 'blue' : 'magenta'](`${index + 1}. ${chunk.file}`))}`;
  out += color.yellow(` [${annScore.toFixed(2)}]`);
  if (chunk.name) out += ' ' + color.cyan(chunk.name);
  out += color.gray(` (${chunk.kind || 'unknown'})`);
  if (chunk.last_author && chunk.last_author !== '2xmvr') out += color.green(` by ${chunk.last_author}`);
  if (chunk.headline) out += ` - ${color.underline(chunk.headline)}`;
  else if (chunk.tokens && chunk.tokens.length && rx) {
    out += ' - ' + chunk.tokens.slice(0, 10).join(' ').replace(rx, (m) => color.bold(color.yellow(m)));
  }

  if (matched && queryTokens.length) {
    const matchedTokens = queryTokens.filter((tok) =>
      (chunk.tokens && chunk.tokens.includes(tok)) ||
      (chunk.ngrams && chunk.ngrams.includes(tok)) ||
      (chunk.headline && chunk.headline.includes(tok))
    );
    if (matchedTokens.length) {
      out += color.gray(` Matched: ${matchedTokens.join(', ')}`);
    }
  }

  out += '\n';
  return out;
}
