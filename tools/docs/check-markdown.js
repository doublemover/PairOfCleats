#!/usr/bin/env node
// Source UNVALIDATED. This command audits source; it never runs documentation.
import path from 'node:path';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { checkMarkdownDocuments, inventoryMarkdownDocuments } from './markdown-links.js';

export const runMarkdownAudit = ({ root = process.cwd(), files = null } = {}) => checkMarkdownDocuments({ root,
  files: files || inventoryMarkdownDocuments(root), anchors: true });

if (isDirectExecution(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    let root = process.cwd();
    const files = [];
    let json = false;
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--json') json = true;
      else if (['--root', '--file'].includes(args[index]) && args[index + 1] && !args[index + 1].startsWith('--')) {
        if (args[index] === '--root') root = path.resolve(args[++index]);
        else files.push(args[++index]);
      } else throw new Error('Usage: node tools/docs/check-markdown.js [--root <checkout>] [--file <source.md> ...] [--json]');
    }
    const report = runMarkdownAudit({ root, files: files.length ? files : null });
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      for (const issue of report.issues) console.error(`${issue.source}:${issue.line}: ${issue.code}: ${issue.target || issue.reason || issue.text || ''}`);
      console.error(`Markdown static navigation: ${report.coverage.documents} documents, ${report.coverage.localFragmentsChecked} fragments, ${report.issues.length} issues; remote and behavior unrun.`);
    }
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
