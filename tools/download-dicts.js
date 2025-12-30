#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import minimist from 'minimist';
import { getDictConfig, loadUserConfig, resolveRepoRoot } from './dict-utils.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['update', 'force'],
  string: ['lang', 'dir', 'url', 'repo'],
  default: { update: false, force: false }
});

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const repoRoot = rootArg || resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(repoRoot);
const defaultDictConfig = getDictConfig(repoRoot, userConfig);

const dictDir = argv.dir ? path.resolve(argv.dir) : defaultDictConfig.dir;
await fs.mkdir(dictDir, { recursive: true });
await fs.mkdir(path.join(dictDir, 'slang'), { recursive: true });
await fs.mkdir(path.join(dictDir, 'repos'), { recursive: true });

const manifestPath = path.join(dictDir, 'dictionaries.json');
let manifest = {};
try {
  manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) || {};
} catch {
  manifest = {};
}

const SOURCES = {
  en: {
    name: 'en',
    url: 'https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt',
    file: 'en.txt'
  }
};

/**
 * Parse URL sources from name=url inputs.
 * @param {string|string[]|null} input
 * @returns {Array<{name:string,url:string,file:string}>}
 */
function parseUrls(input) {
  if (!input) return [];
  const items = Array.isArray(input) ? input : [input];
  const sources = [];
  for (const item of items) {
    const [name, url] = item.split('=');
    if (!name || !url) continue;
    sources.push({ name, url, file: `${name}.txt` });
  }
  return sources;
}

/**
 * Fetch a URL with basic redirect handling.
 * @param {string} url
 * @param {object} headers
 * @param {number} redirects
 * @returns {Promise<{statusCode:number,headers:object,body:Buffer}>}
 */
function requestUrl(url, headers = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const parsed = new URL(url);
    const handler = parsed.protocol === 'https:' ? https : http;
    const options = {
      method: 'GET',
      headers
    };
    const req = handler.request(parsed, options, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = res.headers.location;
        if (!location) return reject(new Error('Redirect without location'));
        res.resume();
        return resolve(requestUrl(new URL(location, parsed).toString(), headers, redirects + 1));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Download a dictionary source into the cache.
 * @param {{name:string,url:string,file:string}} source
 * @returns {Promise<{name:string,skipped:boolean}>}
 */
async function downloadSource(source) {
  const outputPath = path.join(dictDir, source.file);
  const entry = manifest[source.name] || {};

  if (!argv.force && !argv.update && fsSync.existsSync(outputPath)) {
    return { name: source.name, skipped: true };
  }

  const headers = {};
  if (argv.update) {
    if (entry.etag) headers['If-None-Match'] = entry.etag;
    if (entry.lastModified) headers['If-Modified-Since'] = entry.lastModified;
  }

  const response = await requestUrl(source.url, headers);
  if (response.statusCode === 304) {
    return { name: source.name, skipped: true };
  }
  if (response.statusCode !== 200) {
    throw new Error(`Failed to download ${source.url}: ${response.statusCode}`);
  }

  const text = response.body.toString('utf8');
  await fs.writeFile(outputPath, text.endsWith('\n') ? text : `${text}\n`);

  manifest[source.name] = {
    url: source.url,
    file: source.file,
    etag: response.headers.etag || null,
    lastModified: response.headers['last-modified'] || null,
    downloadedAt: new Date().toISOString()
  };

  return { name: source.name, skipped: false };
}

const langs = argv.lang
  ? argv.lang.split(',').map((l) => l.trim()).filter(Boolean)
  : defaultDictConfig.languages;

const sources = [];
for (const lang of langs) {
  const src = SOURCES[lang];
  if (src) sources.push(src);
}

const urlSources = parseUrls(argv.url);
sources.push(...urlSources);

if (!sources.length) {
  console.error('No dictionary sources configured. Use --lang or --url name=url.');
  process.exit(1);
}

const results = [];
for (const source of sources) {
  try {
    const result = await downloadSource(source);
    results.push(result);
  } catch (err) {
    console.error(String(err));
  }
}

await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const downloaded = results.filter((r) => !r.skipped).length;
const skipped = results.filter((r) => r.skipped).length;
console.log(`Done. downloaded=${downloaded} skipped=${skipped}`);
