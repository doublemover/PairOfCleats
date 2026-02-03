#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

const parseArgs = () => {
  const parser = yargs(hideBin(process.argv))
    .scriptName('pairofcleats repo-inventory')
    .option('root', { type: 'string' })
    .option('json', { type: 'string', default: 'docs/tooling/repo-inventory.json' })
    .help()
    .alias('h', 'help')
    .strictOptions();
  return parser.parse();
};

const toPosix = (value) => (value == null ? '' : String(value).replace(/\\/g, '/'));

const listFiles = async (dir) => {
  const entries = await fsPromises.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
};

const collectDocs = async (root) => {
  const docsDir = path.join(root, 'docs');
  const files = await listFiles(docsDir);
  return files
    .filter((file) => file.endsWith('.md'))
    .map((file) => toPosix(path.relative(root, file)))
    .sort();
};

const extractDocRefs = (contents) => {
  const refs = new Set();
  const regex = /docs\/[A-Za-z0-9._/-]+\.md/g;
  let match;
  while ((match = regex.exec(contents))) {
    refs.add(match[0]);
  }
  return refs;
};

const collectDocReferences = async (root) => {
  const sources = ['README.md', 'AGENTS.md'];
  const referenced = new Set();
  for (const source of sources) {
    const targetPath = path.join(root, source);
    try {
      const contents = await fsPromises.readFile(targetPath, 'utf8');
      for (const ref of extractDocRefs(contents)) {
        referenced.add(ref);
      }
    } catch {}
  }
  return { sources, referenced };
};

const isEntrypoint = async (filePath) => {
  try {
    const contents = await fsPromises.readFile(filePath, 'utf8');
    const firstLine = contents.split(/\r?\n/, 1)[0] || '';
    return firstLine.startsWith('#!/usr/bin/env node');
  } catch {
    return false;
  }
};

const collectToolEntrypoints = async (root) => {
  const toolsDir = path.join(root, 'tools');
  const files = await listFiles(toolsDir);
  const entrypoints = [];
  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    if (await isEntrypoint(file)) {
      entrypoints.push(toPosix(path.relative(root, file)));
    }
  }
  return entrypoints.sort();
};

const collectScriptCommands = async (root) => {
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(await fsPromises.readFile(pkgPath, 'utf8'));
  const scripts = pkg.scripts || {};
  return {
    names: Object.keys(scripts).sort(),
    commands: Object.values(scripts).map((cmd) => String(cmd).replace(/\\/g, '/'))
  };
};

const collectCliScriptPaths = async (root) => {
  const cliPath = path.join(root, 'bin', 'pairofcleats.js');
  try {
    const contents = await fsPromises.readFile(cliPath, 'utf8');
    const matches = contents.match(/['"]((?:tools|build_index)[^'"]+?\.js)['"]/g) || [];
    return matches.map((match) => match.slice(1, -1).replace(/\\/g, '/'));
  } catch {
    return [];
  }
};

const findReferencedTools = (entrypoints, scriptCommands, cliScripts) => {
  const referencedByScripts = new Set();
  const referencedByCli = new Set();
  for (const entrypoint of entrypoints) {
    if (scriptCommands.some((command) => command.includes(entrypoint))) {
      referencedByScripts.add(entrypoint);
    }
    if (cliScripts.some((command) => command.includes(entrypoint))) {
      referencedByCli.add(entrypoint);
    }
  }
  const referenced = new Set([...referencedByScripts, ...referencedByCli]);
  return {
    referencedByScripts: Array.from(referencedByScripts).sort(),
    referencedByCli: Array.from(referencedByCli).sort(),
    referenced: Array.from(referenced).sort()
  };
};

const listTextFiles = async (root, dir, extensions, exclude = new Set()) => {
  const targetDir = path.join(root, dir);
  const files = await listFiles(targetDir);
  return files.filter((file) => {
    if (exclude.has(toPosix(path.relative(root, file)))) return false;
    if (!extensions.length) return true;
    return extensions.includes(path.extname(file));
  });
};

const extractScriptRefs = (contents) => {
  const names = new Set();
  const runRegex = /npm\s+run\s+([a-z0-9:_-]+)/gi;
  let match;
  while ((match = runRegex.exec(contents))) {
    names.add(match[1]);
  }
  if (/npm\s+test\b/i.test(contents)) {
    names.add('test');
  }
  return names;
};

const collectScriptReferences = async (root) => {
  const docsExclude = new Set(['docs/guides/commands.md']);
  const docsFiles = await listTextFiles(root, 'docs', ['.md'], docsExclude);
  const ciFiles = await listTextFiles(root, '.github', ['.yml', '.yaml', '.md']);
  const testFiles = await listTextFiles(root, 'tests', ['.js', '.md']);
  const collectFromFiles = async (files) => {
    const refs = new Set();
    for (const file of files) {
      try {
        const contents = await fsPromises.readFile(file, 'utf8');
        for (const name of extractScriptRefs(contents)) {
          refs.add(name);
        }
      } catch {}
    }
    return refs;
  };
  const [docsRefs, ciRefs, testRefs] = await Promise.all([
    collectFromFiles(docsFiles),
    collectFromFiles(ciFiles),
    collectFromFiles(testFiles)
  ]);
  const referenced = new Set([...docsRefs, ...ciRefs, ...testRefs]);
  return {
    referencedByDocs: Array.from(docsRefs).sort(),
    referencedByCi: Array.from(ciRefs).sort(),
    referencedByTests: Array.from(testRefs).sort(),
    referenced: Array.from(referenced).sort()
  };
};

const main = async () => {
  const argv = parseArgs();
  const root = path.resolve(argv.root || process.cwd());
  const outputPath = path.resolve(root, argv.json);

  const docs = await collectDocs(root);
  const docRefs = await collectDocReferences(root);
  const referencedDocs = docs.filter((doc) => docRefs.referenced.has(doc));
  const orphanDocs = docs.filter((doc) => !docRefs.referenced.has(doc));

  const toolEntrypoints = await collectToolEntrypoints(root);
  const scriptInfo = await collectScriptCommands(root);
  const cliScripts = await collectCliScriptPaths(root);
  const toolRefs = findReferencedTools(toolEntrypoints, scriptInfo.commands, cliScripts);
  const orphanTools = toolEntrypoints.filter((entry) => !toolRefs.referenced.includes(entry));

  const scriptRefs = await collectScriptReferences(root);
  const orphanScripts = scriptInfo.names.filter((name) => !scriptRefs.referenced.includes(name));

  const report = {
    generatedAt: new Date().toISOString(),
    generatedBy: 'node tools/repo-inventory.js',
    root: toPosix(root),
    docs: {
      sources: docRefs.sources,
      files: docs,
      referenced: referencedDocs,
      orphans: orphanDocs
    },
    tools: {
      entrypoints: toolEntrypoints,
      referencedByScripts: toolRefs.referencedByScripts,
      referencedByCli: toolRefs.referencedByCli,
      referenced: toolRefs.referenced,
      orphans: orphanTools
    },
    scripts: {
      all: scriptInfo.names,
      referencedByDocs: scriptRefs.referencedByDocs,
      referencedByCi: scriptRefs.referencedByCi,
      referencedByTests: scriptRefs.referencedByTests,
      referenced: scriptRefs.referenced,
      orphans: orphanScripts
    },
    notes: [
      'Docs references are collected only from README.md and AGENTS.md.',
      'Script references are collected from docs (excluding docs/guides/commands.md), .github workflows, and tests.',
      'Tool entrypoints are detected by a node shebang; only those are considered for orphan tool reporting.'
    ]
  };

  await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
  await fsPromises.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
