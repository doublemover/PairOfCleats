#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { extractPdf, loadPdfExtractorRuntime } from '../../../src/index/extractors/pdf.js';
import { extractDocx, loadDocxExtractorRuntime } from '../../../src/index/extractors/docx.js';
import { formatStats, summarizeDurations } from './utils.js';

const argv = yargs(hideBin(process.argv))
  .option('pdf', {
    type: 'string',
    array: true,
    describe: 'Path(s) to PDF files (comma-separated or repeated)'
  })
  .option('docx', {
    type: 'string',
    array: true,
    describe: 'Path(s) to DOCX files (comma-separated or repeated)'
  })
  .option('iterations', {
    type: 'number',
    describe: 'Iterations per file',
    default: 5
  })
  .option('warmup', {
    type: 'number',
    describe: 'Warmup iterations per file',
    default: 1
  })
  .option('json', {
    type: 'boolean',
    describe: 'Emit JSON output only',
    default: false
  })
  .option('out', {
    type: 'string',
    describe: 'Write JSON results to a file'
  })
  .help()
  .argv;

const pdfFiles = normalizePaths(argv.pdf || []);
const docxFiles = normalizePaths(argv.docx || []);
const iterations = Math.max(1, Math.floor(argv.iterations));
const warmup = Math.max(0, Math.floor(argv.warmup));

if (!pdfFiles.length && !docxFiles.length) {
  console.error('[extractors] Provide --pdf and/or --docx file paths.');
  process.exit(1);
}

const results = {
  generatedAt: new Date().toISOString(),
  iterations,
  warmup,
  pdf: { available: false, files: [] },
  docx: { available: false, files: [] }
};

const pdfRuntime = pdfFiles.length ? await loadPdfExtractorRuntime() : null;
if (pdfFiles.length) {
  if (!pdfRuntime?.ok) {
    results.pdf.available = false;
  } else {
    results.pdf.available = true;
    results.pdf.files = await runExtractorBench(
      pdfFiles,
      async (filePath, buffer) => {
        const extracted = await extractPdf({ filePath, buffer });
        if (!extracted.ok) {
          throw new Error(`pdf extract failed (${extracted.reason})`);
        }
        return {
          pages: extracted.pages.length,
          chars: extracted.pages.reduce((sum, page) => sum + String(page?.text || '').length, 0)
        };
      },
      { iterations, warmup }
    );
  }
}

const docxRuntime = docxFiles.length ? await loadDocxExtractorRuntime() : null;
if (docxFiles.length) {
  if (!docxRuntime?.ok) {
    results.docx.available = false;
  } else {
    results.docx.available = true;
    results.docx.files = await runExtractorBench(
      docxFiles,
      async (filePath, buffer) => {
        const extracted = await extractDocx({ filePath, buffer });
        if (!extracted.ok) {
          throw new Error(`docx extract failed (${extracted.reason})`);
        }
        return {
          paragraphs: extracted.paragraphs.length,
          chars: extracted.paragraphs.reduce((sum, paragraph) => sum + String(paragraph?.text || '').length, 0)
        };
      },
      { iterations, warmup }
    );
  }
}

if (argv.out) {
  const outPath = path.resolve(argv.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  if (pdfFiles.length) {
    if (!results.pdf.available) {
      console.error('- pdf: unavailable (install optional "pdfjs-dist" dependency)');
    } else {
      printSummary('pdf', results.pdf.files);
    }
  }
  if (docxFiles.length) {
    if (!results.docx.available) {
      console.error('- docx: unavailable (install optional "mammoth" dependency)');
    } else {
      printSummary('docx', results.docx.files);
    }
  }
}

function normalizePaths(values) {
  const entries = [];
  for (const raw of values) {
    const split = String(raw || '').split(',').map((v) => v.trim()).filter(Boolean);
    entries.push(...split);
  }
  return entries.map((entry) => path.resolve(entry));
}

async function runExtractorBench(files, extractFn, { iterations, warmup }) {
  const runs = [];
  for (const filePath of files) {
    const stat = await fsPromises.stat(filePath);
    const buffer = await fsPromises.readFile(filePath);
    for (let i = 0; i < warmup; i += 1) {
      await extractFn(filePath, buffer);
    }
    const timings = [];
    let maxRss = 0;
    let maxHeapUsed = 0;
    let lastMeta = null;
    for (let i = 0; i < iterations; i += 1) {
      const start = process.hrtime.bigint();
      lastMeta = await extractFn(filePath, buffer);
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      timings.push(elapsed);
      const mem = process.memoryUsage();
      maxRss = Math.max(maxRss, mem.rss || 0);
      maxHeapUsed = Math.max(maxHeapUsed, mem.heapUsed || 0);
    }
    runs.push({
      file: filePath,
      bytes: stat.size,
      iterations,
      stats: summarizeDurations(timings),
      maxRss,
      maxHeapUsed,
      lastMeta
    });
  }
  return runs;
}

function printSummary(label, files) {
  for (const entry of files) {
    const stats = entry.stats ? formatStats(entry.stats) : 'n/a';
    const rssMb = entry.maxRss ? (entry.maxRss / (1024 * 1024)).toFixed(1) : 'n/a';
    const heapMb = entry.maxHeapUsed ? (entry.maxHeapUsed / (1024 * 1024)).toFixed(1) : 'n/a';
    console.error(`[${label}] ${entry.file}`);
    console.error(`- bytes=${entry.bytes} | ${stats}`);
    console.error(`- max RSS ${rssMb} MB | max heap ${heapMb} MB`);
  }
}
