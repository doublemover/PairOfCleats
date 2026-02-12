#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const archivedRoot = path.join(repoRoot, 'docs', 'archived');
const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');

const ciOrderText = fs.readFileSync(ciOrderPath, 'utf8');
const ciLiteOrderText = fs.readFileSync(ciLiteOrderPath, 'utf8');
const prTemplatePath = path.join(repoRoot, '.github', 'pull_request_template.md');
const prTemplateText = fs.readFileSync(prTemplatePath, 'utf8');

const requiredTestId = 'lang/contracts/usr-archival-deprecation-policy-validation';
assert.equal(ciOrderText.includes(requiredTestId), true, `ci order missing archival/deprecation validator: ${requiredTestId}`);
assert.equal(ciLiteOrderText.includes(requiredTestId), true, `ci-lite order missing archival/deprecation validator: ${requiredTestId}`);

assert.equal(fs.existsSync(archivedRoot), true, 'docs/archived directory must exist');

assert.equal(prTemplateText.includes('<!-- usr-policy:deprecation-archive -->'), true, 'PR template must include deprecation-archive policy marker');
assert.equal(prTemplateText.includes('`docs/archived/`'), true, 'deprecation-archive checklist must reference docs/archived path');
assert.equal(/DEPRECATED header/i.test(prTemplateText), true, 'deprecation-archive checklist must require DEPRECATED header metadata');

const collectMarkdownFiles = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
};

const markdownFiles = collectMarkdownFiles(archivedRoot);

const isUsrArchivedSpec = (fullPath) => {
  const relative = path.relative(archivedRoot, fullPath).replace(/\\/g, '/').toLowerCase();
  return relative.startsWith('usr-') || relative.includes('/usr/') || relative.includes('/usr-');
};

const usrArchivedSpecs = markdownFiles.filter(isUsrArchivedSpec);
for (const fullPath of usrArchivedSpecs) {
  const text = fs.readFileSync(fullPath, 'utf8');
  const preview = text.split(/\r?\n/).slice(0, 40).join('\n');
  const rel = path.relative(repoRoot, fullPath).replace(/\\/g, '/');

  assert.equal(/^#\s*DEPRECATED\b/im.test(preview), true, `archived USR doc must begin with DEPRECATED header: ${rel}`);
  assert.equal(/canonical replacement/i.test(preview), true, `archived USR doc missing canonical replacement line: ${rel}`);
  assert.equal(/reason/i.test(preview), true, `archived USR doc missing deprecation reason line: ${rel}`);
  assert.equal(/date|deprecated on/i.test(preview), true, `archived USR doc missing deprecation date line: ${rel}`);
  assert.equal(/pr|commit/i.test(preview), true, `archived USR doc missing deprecation PR/commit line: ${rel}`);
}

console.log('usr archival/deprecation policy validation checks passed');
