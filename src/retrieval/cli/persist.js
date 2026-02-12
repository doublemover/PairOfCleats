import fs from 'node:fs/promises';
import path from 'node:path';

export async function recordSearchArtifacts({
  metricsDir,
  query,
  queryTokens,
  proseHits,
  extractedProseHits,
  codeHits,
  recordHits,
  elapsedMs,
  cacheHit,
  asOf = null
}) {
  try {
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
    const inc = (file, key) => {
      if (!metrics[file]) metrics[file] = { md: 0, extractedProse: 0, code: 0, records: 0, terms: [] };
      metrics[file][key] = (metrics[file][key] || 0) + 1;
      queryTokens.forEach((token) => {
        if (!metrics[file].terms.includes(token)) metrics[file].terms.push(token);
      });
    };
    proseHits.forEach((hit) => inc(hit.file, 'md'));
    extractedProseHits.forEach((hit) => inc(hit.file, 'extractedProse'));
    codeHits.forEach((hit) => inc(hit.file, 'code'));
    recordHits.forEach((hit) => inc(hit.file, 'records'));
    await fs.writeFile(metricsPath, JSON.stringify(metrics) + '\n');

    await fs.appendFile(
      historyPath,
      JSON.stringify({
        time: new Date().toISOString(),
        query,
        mdFiles: proseHits.length,
        extractedProseFiles: extractedProseHits.length,
        codeFiles: codeHits.length,
        recordFiles: recordHits.length,
        ms: elapsedMs,
        cached: cacheHit,
        asOfType: asOf?.type || null,
        asOfIdentity: asOf?.identityHash
          ? String(asOf.identityHash).slice(0, 8)
          : null
      }) + '\n'
    );

    if (proseHits.length === 0 && extractedProseHits.length === 0 && codeHits.length === 0 && recordHits.length === 0) {
      await fs.appendFile(
        noResultPath,
        JSON.stringify({ time: new Date().toISOString(), query }) + '\n'
      );
    }
  } catch {}
}
