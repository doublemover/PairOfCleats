#!/usr/bin/env node
/**
 * Ultra-Complete Search Utility for Rich Semantic Index (Pretty Output)
 * By: ChatGPT & Nick, 2025
 *   [--calls function]  Filter for call relationships (calls to/from function)
 *   [--uses ident]      Filter for usage of identifier
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import minimist from 'minimist';
import Snowball from 'snowball-stemmers';
import Minhash from 'minhash';

const argv = minimist(process.argv.slice(2), {
  boolean: ['json', 'human', 'stats', 'ann', 'headline', 'lint', 'churn', 'matched'],
  alias: { n: 'top', c: 'context', t: 'type' },
  default: { n: 5, context: 3 },
  string: ['calls', 'uses', 'signature', 'param', 'mode'],
});
const t0 = Date.now();
const ROOT = process.cwd();
const metricsDir = path.join(ROOT, '.repoMetrics');
const query = argv._.join(' ').trim();
if (!query) {
  console.error('usage: search "query" [--json|--human|--stats|--ann|--context N|--type T|...]|--mode');
  process.exit(1);
}
const contextLines = Math.max(0, parseInt(argv.context, 10) || 0);
const searchType = argv.type || null;
const searchAuthor = argv.author || null;
const searchCall = argv.call || null;
const searchImport = argv.import || null;
const searchMode = argv.mode || "both";

const stemmer = Snowball.newStemmer('english');
const stem = (w) => stemmer.stem(w);
const camel = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
const splitId = (s) =>
  s.replace(/([a-z])([A-Z])/g, '$1 $2')        // split camelCase
    .replace(/[_\-]+/g, ' ')                   // split on _ and -
    .split(/[^a-zA-Z0-9]+/u)                   // split non-alphanum
    .flatMap(tok => tok.split(/(?<=.)(?=[A-Z])/)) // split merged camel even if lowercase input
    .map(t => t.toLowerCase())
    .filter(Boolean);

// Load English wordlist
const wordListPath = path.join('tools/', 'words_alpha.txt');
const englishWords = fsSync.readFileSync(wordListPath, 'utf8')
  .split('\n')
  .map(w => w.trim().toLowerCase())
  .filter(Boolean);

const dict = new Set(englishWords);

const color = {
  green: (t) => `\x1b[32m${t}\x1b[0m`,
  yellow: (t) => `\x1b[33m${t}\x1b[0m`,
  red: (t) => `\x1b[31m${t}\x1b[0m`,
  cyan: (t) => `\x1b[36m${t}\x1b[0m`,
  magenta: (t) => `\x1b[35m${t}\x1b[0m`,
  blue: (t) => `\x1b[34m${t}\x1b[0m`,
  gray: (t) => `\x1b[90m${t}\x1b[0m`,
  bold: (t) => `\x1b[1m${t}\x1b[0m`,
  underline: (t) => `\x1b[4m${t}\x1b[0m`
};

// --- LOAD INDEX ---
function loadIndex(dir) {
  return {
    chunkMeta: JSON.parse(fsSync.readFileSync(path.join(dir, 'chunk_meta.json'), 'utf8')),
    denseVec: JSON.parse(fsSync.readFileSync(path.join(dir, 'dense_vectors_uint8.json'), 'utf8')),
    minhash: JSON.parse(fsSync.readFileSync(path.join(dir, 'minhash_signatures.json'), 'utf8')),
    phraseNgrams: JSON.parse(fsSync.readFileSync(path.join(dir, 'phrase_ngrams.json'), 'utf8')),
    chargrams: JSON.parse(fsSync.readFileSync(path.join(dir, 'chargram_postings.json'), 'utf8'))
  };
}
const idxProse = loadIndex('index-prose');
const idxCode = loadIndex('index-code');

// --- QUERY TOKENIZATION ---
function splitWordsWithDict(token, dict) {
  const result = [];
  let i = 0;
  while (i < token.length) {
    let found = false;
    for (let j = token.length; j > i; j--) {
      const sub = token.slice(i, j);
      if (dict.has(sub)) {
        result.push(sub);
        i = j;
        found = true;
        break;
      }
    }
    if (!found) {
      // fallback: add single char to avoid infinite loop
      result.push(token[i]);
      i++;
    }
  }
  return result;
}


let queryTokens = splitId(query);

queryTokens = queryTokens.flatMap(tok => {
  if (tok.length <= 3 || dict.has(tok)) return [tok];
  return splitWordsWithDict(tok, dict);
});

const rx = new RegExp(`(${queryTokens.join('|')})`, 'ig');

// --- SEARCH BM25 TOKENS/PHRASES ---
function rankBM25(idx, tokens, topN) {
  const scores = new Map();
  idx.chunkMeta.forEach((chunk, i) => {
    let score = 0;
    queryTokens.forEach(tok => {
      if (chunk.ngrams && chunk.ngrams.includes(tok)) score += 2 * (chunk.weight || 1);
      if (chunk.headline && chunk.headline.includes(tok)) score += 3 * (chunk.weight || 1);
    });
    scores.set(i, score);
  });
  return [...scores.entries()]
    .filter(([i, s]) => s > 0)
    .map(([i, s]) => ({ idx: i, score: s }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// --- SEARCH MINHASH ANN (for semantic embedding search) ---
function minhashSigForTokens(tokens) {
  const mh = new Minhash();
  tokens.forEach(t => mh.update(t));
  return mh.hashvalues;
}
function jaccard(sigA, sigB) {
  let match = 0;
  for (let i = 0; i < sigA.length; i++) if (sigA[i] === sigB[i]) match++;
  return match / sigA.length;
}
function rankMinhash(idx, tokens, topN) {
  const qSig = minhashSigForTokens(tokens);
  const scored = idx.minhash.signatures
    .map((sig, i) => ({ idx: i, sim: jaccard(qSig, sig) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, topN);
  return scored;
}

// --- ADVANCED FILTERING ---
function filterChunks(meta, opts = {}) {
  return meta.filter(c => {
    if (opts.type && c.kind && c.kind.toLowerCase() !== opts.type.toLowerCase()) return false;
    if (opts.author && c.last_author && !c.last_author.toLowerCase().includes(opts.author.toLowerCase())) return false;
    if (opts.call && c.codeRelations && c.codeRelations.calls) {
      const found = c.codeRelations.calls.find(([fn, call]) => call === opts.call || fn === opts.call);
      if (!found) return false;
    }
    if (opts.import && c.codeRelations && c.codeRelations.imports) {
      if (!c.codeRelations.imports.includes(opts.import)) return false;
    }
    if (opts.lint && (!c.lint || !c.lint.length)) return false;
    if (opts.churn && (!c.churn || c.churn < opts.churn)) return false;
    if (argv.calls && c.codeRelations && c.codeRelations.calls) {
      const found = c.codeRelations.calls.find(([fn, call]) => fn === argv.calls || call === argv.calls);
      if (!found) return false;
    }
    if (argv.uses && c.codeRelations && c.codeRelations.usages) {
      if (!c.codeRelations.usages.includes(argv.uses)) return false;
    }
    if (argv.signature && c.docmeta?.signature) {
      if (!c.docmeta.signature.includes(argv.signature)) return false;
    }
    if (argv.param && c.docmeta?.params) {
      if (!c.docmeta.params.includes(argv.param)) return false;
    }
    return true;
  });
}

function cleanContext(lines) {
  return lines
    .filter(l => {
      const t = l.trim();
      if (!t || t === '```') return false;
      // Skip lines where there is no alphanumeric content
      if (!/[a-zA-Z0-9]/.test(t)) return false;
      return true;
    })
    .map(l => l.replace(/\s+/g, ' ').trim()); // <— normalize whitespace here
}


// --- FORMAT OUTPUT ---
function getBodySummary(h, maxWords = 80) {
  try {
    const absPath = path.join(ROOT, h.file);
    const text = fsSync.readFileSync(absPath, 'utf8');
    const chunkText = text.slice(h.start, h.end)
      .replace(/\s+/g, ' ') // normalize spaces
      .trim();
    const words = chunkText.split(/\s+/).slice(0, maxWords).join(' ');
    return words;
  } catch {
    return '(Could not load summary)';
  }
}

let lastCount = 0;
function printFullChunk(chunk, idx, mode, annScore, annType = 'bm25') {
  if (!chunk || !chunk.file) {
    return color.red(`   ${idx + 1}. [Invalid result — missing chunk or file]`) + '\n';
  }
  const c = color;
  let out = '';

  const line1 = [
    c.bold(c[mode === 'code' ? 'blue' : 'magenta'](`${idx + 1}. ${chunk.file}`)),
    c.cyan(chunk.name || ''),
    c.yellow(chunk.kind || ''),
    c.green(`${annScore.toFixed(2)}`),
    c.gray(`Start/End: ${chunk.start}/${chunk.end}`),
    typeof chunk.churn === 'number' ? c.yellow(`Churn: ${chunk.churn}`) : ''
  ].filter(Boolean).join('  ');

  out += line1 + '\n';

  const headlinePart = chunk.headline ? c.bold('Headline: ') + c.underline(chunk.headline) : '';
  const lastModPart = chunk.last_modified ? c.gray('Last Modified: ') + c.bold(chunk.last_modified) : '';
  const secondLine = [headlinePart, lastModPart].filter(Boolean).join('   ');
  if (secondLine) out += '   ' + secondLine + '\n';

  if (chunk.last_author && chunk.last_author !== '2xmvr')
    out += c.gray('   Last Author: ') + c.green(chunk.last_author) + '\n';

  if (chunk.imports?.length)
    out += c.magenta('   Imports: ') + chunk.imports.join(', ') + '\n';
  else if (chunk.codeRelations?.imports?.length)
    out += c.magenta('   Imports: ') + chunk.codeRelations.imports.join(', ') + '\n';

  if (chunk.exports?.length)
    out += c.blue('   Exports: ') + chunk.exports.join(', ') + '\n';
  else if (chunk.codeRelations?.exports?.length)
    out += c.blue('   Exports: ') + chunk.codeRelations.exports.join(', ') + '\n';

  if (chunk.codeRelations?.calls?.length)
    out += c.yellow('   Calls: ') + chunk.codeRelations.calls.map(([a, b]) => `${a}→${b}`).join(', ') + '\n';

  if (chunk.codeRelations?.importLinks?.length)
    out += c.green('   ImportLinks: ') + chunk.codeRelations.importLinks.join(', ') + '\n';

  // Usages
  if (chunk.codeRelations?.usages?.length) {
    const usageFreq = Object.create(null);
    chunk.codeRelations.usages.forEach(uRaw => {
      const u = typeof uRaw === 'string' ? uRaw.trim() : '';
      if (!u) return;
      usageFreq[u] = (usageFreq[u] || 0) + 1;
    });

    const usageEntries = Object.entries(usageFreq).sort((a, b) => b[1] - a[1]);
    const maxCount = usageEntries[0]?.[1] || 0;

    const usageStr = usageEntries.slice(0, 10).map(([u, count]) => {
      if (count === 1) return u;
      if (count === maxCount) return c.bold(c.yellow(`${u} (${count})`));
      return c.cyan(`${u} (${count})`);
    }).join(', ');

    if (usageStr.length) out += c.cyan('   Usages: ') + usageStr + '\n';
  }

  const uniqueTokens = [...new Set((chunk.tokens || []).map(t => t.trim()).filter(t => t))];
  if (uniqueTokens.length)
    out += c.magenta('   Tokens: ') + uniqueTokens.slice(0, 10).join(', ') + '\n';

  if (argv.matched) {
    const matchedTokens = tokens.filter(tok =>
      (chunk.tokens && chunk.tokens.includes(tok)) ||
      (chunk.ngrams && chunk.ngrams.includes(tok)) ||
      (chunk.headline && chunk.headline.includes(tok))
    );
    if (matchedTokens.length)
      out += c.gray('   Matched: ') + matchedTokens.join(', ') + '\n';
  }

  if (chunk.docmeta?.signature)
    out += c.cyan('   Signature: ') + chunk.docmeta.signature + '\n';

  if (chunk.lint?.length)
    out += c.red(`   Lint: ${chunk.lint.length} issues`) +
      (chunk.lint.length ? c.gray(' | ') + chunk.lint.slice(0,2).map(l => JSON.stringify(l.message)).join(', ') : '') + '\n';

  if (chunk.externalDocs?.length)
    out += c.blue('   Docs: ') + chunk.externalDocs.join(', ') + '\n';

  const cleanedPreContext = chunk.preContext ? cleanContext(chunk.preContext) : [];
  if (cleanedPreContext.length)
    out += c.gray('   preContext: ') + cleanedPreContext.map(l => c.green(l.trim())).join(' | ') + '\n';

  const cleanedPostContext = chunk.postContext ? cleanContext(chunk.postContext) : [];
  if (cleanedPostContext.length)
    out += c.gray('   postContext: ') + cleanedPostContext.map(l => c.green(l.trim())).join(' | ') + '\n';

  if (idx === 0) {
    lastCount = 0;
  }
  if (idx < 5) {
    let maxWords = 10;
    let lessPer = 3;
    maxWords -= (lessPer*idx);
    const bodySummary = getBodySummary(chunk, maxWords);
    if (lastCount < maxWords) {
      maxWords = bodySummary.length; 
    }
    lastCount = bodySummary.length;
    out += c.gray('   Summary: ') + `${getBodySummary(chunk, maxWords)}` + '\n';
  }

  out += c.gray(''.padEnd(60, '—')) + '\n';
  return out;
}


function printShortChunk(chunk, idx, mode, annScore, annType = 'bm25') {
  if (!chunk || !chunk.file) {
    return color.red(`   ${idx + 1}. [Invalid result — missing chunk or file]`) + '\n';
  }
  let out = '';
  out += `${color.bold(color[mode === 'code' ? 'blue' : 'magenta'](`${idx + 1}. ${chunk.file}`))}`;
  out += color.yellow(` [${annScore.toFixed(2)}]`);
  if (chunk.name) out += ' ' + color.cyan(chunk.name);
  out += color.gray(` (${chunk.kind || 'unknown'})`);
  if (chunk.last_author && chunk.last_author !== '2xmvr') out += color.green(` by ${chunk.last_author}`);
  if (chunk.headline) out += ` - ${color.underline(chunk.headline)}`;
  else if (chunk.tokens && chunk.tokens.length)
    out += ' - ' + chunk.tokens.slice(0, 10).join(' ').replace(rx, (m) => color.bold(color.yellow(m)));

  if (argv.matched) {
    const matchedTokens = tokens.filter(tok =>
      (chunk.tokens && chunk.tokens.includes(tok)) ||
      (chunk.ngrams && chunk.ngrams.includes(tok)) ||
      (chunk.headline && chunk.headline.includes(tok))
    );
    if (matchedTokens.length)
      out += color.gray(` Matched: ${matchedTokens.join(', ')}`);
  }

  out += '\n';
  return out;
}


// --- MAIN SEARCH PIPELINE ---
function runSearch(idx, mode) {
  const meta = idx.chunkMeta;

  // Filtering
  const filteredMeta = filterChunks(meta, {
    type: searchType,
    author: searchAuthor,
    call: searchCall,
    import: searchImport,
    lint: argv.lint,
    churn: argv.churn
  });
  const allowedIdx = new Set(filteredMeta.map(c => c.id));

  // Main search: BM25 token match
  const bmHits = rankBM25(idx, queryTokens, argv.n * 3);
  // MinHash (embedding) ANN, if requested
  const annHits = argv.ann ? rankMinhash(idx, tokens, argv.n * 3) : [];

  // Combine and dedup
  let allHits = new Map();
  bmHits.forEach(h => allHits.set(h.idx, { score: h.score, kind: 'bm25' }));
  annHits.forEach(h => {
    if (!allHits.has(h.idx) || h.sim > allHits.get(h.idx).score)
      allHits.set(h.idx, { score: h.sim, kind: 'ann' });
  });

  // Sort and map to final results
  const ranked = [...allHits.entries()]
    .filter(([idx, _]) => allowedIdx.has(idx))
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, argv.n)
    .map(([idxVal, obj]) => {
      const chunk = meta[idxVal];
      return chunk ? { ...chunk, annScore: obj.score, annType: obj.kind } : null;
    })
    .filter(x => x);

  return ranked;
}


// --- MAIN ---
(async () => {
  let proseHits = runSearch(idxProse, 'prose');
  let codeHits = runSearch(idxCode, 'code');

  // Output
  if (argv.json) {
    // Full JSON
    console.log(JSON.stringify({
      prose: proseHits,
      code: codeHits
    }, null, 2));
    process.exit(0);
  }

  let showProse = argv.n;
  let showCode = argv.n;

  if (proseHits < argv.n) {
    showCode += showProse;
  }
  if (codeHits < argv.n) {
    showProse += showCode;
  }

  // Human output, enhanced formatting and summaries
  console.log(color.bold('\n===== 📖 Markdown Results ====='));
  proseHits.slice(0, showProse).forEach((h, i) => {
    if (i < 2) {
      process.stdout.write(printFullChunk(h, i, 'prose', h.annScore, h.annType));
    } else {
      process.stdout.write(printShortChunk(h, i, 'prose', h.annScore, h.annType));
    }
  });
  console.log('\n');

  console.log(color.bold('===== 🔨 Code Results ====='));
  codeHits.slice(0, showCode).forEach((h, i) => {
    if (i < 1) {
      process.stdout.write(printFullChunk(h, i, 'code', h.annScore, h.annType));
    } else {
      process.stdout.write(printShortChunk(h, i, 'code', h.annScore, h.annType));
    }
  });
  console.log('\n');

  // Optionally stats
  if (argv.stats) {
    console.log(color.gray(`Stats: prose chunks=${idxProse.chunkMeta.length}, code chunks=${idxCode.chunkMeta.length}`));
  }

  /* ---------- Update .repoMetrics and .searchHistory ---------- */
  const metricsPath = path.join(metricsDir, 'metrics.json');
  const historyPath = path.join(metricsDir, 'searchHistory');
  const noResultPath = path.join(metricsDir, 'noResultQueries');
  await fs.mkdir(path.dirname(metricsPath), { recursive: true });

  let metrics = {};
  try {
    metrics = JSON.parse(await fs.readFile(metricsPath, 'utf8'));
  } catch {
    metrics = {};
  }
  const inc = (f, key) => {
    if (!metrics[f]) metrics[f] = { md: 0, code: 0, terms: [] };
    metrics[f][key]++;
    queryTokens.forEach((t) => {
      if (!metrics[f].terms.includes(t)) metrics[f].terms.push(t);
    });
  };
  proseHits.forEach((h) => inc(h.file, 'md'));
  codeHits.forEach((h) => inc(h.file, 'code'));
  await fs.writeFile(metricsPath, JSON.stringify(metrics) + '\n');

  await fs.appendFile(
    historyPath,
    JSON.stringify({
      time: new Date().toISOString(),
      query,
      mdFiles: proseHits.length,
      codeFiles: codeHits.length,
      ms: Date.now() - t0,
    }) + '\n'
  );

  if (proseHits.length === 0 && codeHits.length === 0) {
    await fs.appendFile(
      noResultPath,
      JSON.stringify({ time: new Date().toISOString(), query }) + '\n'
    );
  }
})();
