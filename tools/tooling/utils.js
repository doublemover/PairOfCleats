import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { canRunCommand } from '../shared/cli-utils.js';
import { LOCK_FILES, MANIFEST_FILES, SKIP_DIRS, SKIP_FILES } from '../../src/index/constants.js';
import { toPosix } from '../../src/shared/files.js';
import { getToolingConfig } from '../shared/dict-utils.js';

const LANGUAGE_EXTENSIONS = {
  javascript: ['.js', '.mjs', '.cjs'],
  typescript: ['.ts', '.tsx', '.mts', '.cts'],
  python: ['.py', '.pyi'],
  c: ['.c', '.h'],
  cpp: ['.cc', '.cpp', '.hpp', '.hh'],
  objc: ['.m', '.mm'],
  rust: ['.rs'],
  go: ['.go'],
  java: ['.java'],
  swift: ['.swift'],
  shell: ['.sh', '.bash', '.zsh', '.ksh'],
  csharp: ['.cs'],
  kotlin: ['.kt', '.kts'],
  ruby: ['.rb'],
  php: ['.php', '.phtml'],
  lua: ['.lua'],
  sql: ['.sql', '.psql', '.pgsql', '.mysql', '.sqlite']
};

const FORMAT_EXTENSIONS = {
  json: ['.json'],
  toml: ['.toml'],
  ini: ['.ini', '.cfg', '.conf'],
  xml: ['.xml'],
  yaml: ['.yml', '.yaml'],
  rst: ['.rst'],
  asciidoc: ['.adoc', '.asciidoc']
};

const FORMAT_FILENAMES = {
  dockerfile: ['dockerfile'],
  makefile: ['makefile', 'gnumakefile'],
  manifest: Array.from(MANIFEST_FILES),
  lockfile: Array.from(LOCK_FILES)
};

const FORMAT_FILENAME_PREFIXES = {
  dockerfile: ['dockerfile.'],
  makefile: ['makefile.']
};

const TOOL_DOCS = {
  tsserver: 'https://www.typescriptlang.org/',
  'typescript-language-server': 'https://github.com/typescript-language-server/typescript-language-server',
  clangd: 'https://clangd.llvm.org/installation',
  'rust-analyzer': 'https://rust-analyzer.github.io/',
  gopls: 'https://pkg.go.dev/golang.org/x/tools/gopls',
  jdtls: 'https://github.com/eclipse-jdtls/eclipse.jdt.ls',
  'sourcekit-lsp': 'https://www.swift.org/download/',
  'kotlin-language-server': 'https://github.com/fwcd/kotlin-language-server',
  'kotlin-lsp': 'https://kotlinlang.org/docs/',
  pyright: 'https://github.com/microsoft/pyright',
  omnisharp: 'https://github.com/OmniSharp/omnisharp-roslyn',
  'csharp-ls': 'https://github.com/razzmatazz/csharp-language-server',
  'ruby-lsp': 'https://shopify.github.io/ruby-lsp/',
  solargraph: 'https://solargraph.org/',
  phpactor: 'https://phpactor.readthedocs.io/',
  intelephense: 'https://github.com/bmewburn/intelephense-docs',
  'bash-language-server': 'https://github.com/bash-lsp/bash-language-server',
  'lua-language-server': 'https://github.com/LuaLS/lua-language-server',
  sqls: 'https://github.com/lighttiger2505/sqls'
};

const candidateNames = (name) => {
  if (process.platform === 'win32') {
    return [`${name}.cmd`, `${name}.exe`, name];
  }
  return [name];
};

function findBinaryInDirs(name, dirs) {
  const candidates = candidateNames(name);
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

function canRun(cmd, args = ['--version']) {
  return canRunCommand(cmd, args);
}

async function scanRepo(root) {
  const extCounts = new Map();
  const lowerNames = new Set();
  let workflowCount = 0;
  const visit = async (dir) => {
    let entries;
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await visit(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SKIP_FILES.has(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext) extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
      lowerNames.add(entry.name.toLowerCase());
      const normalized = toPosix(abs).toLowerCase();
      if (normalized.includes('/.github/workflows/')
        && (normalized.endsWith('.yml') || normalized.endsWith('.yaml'))) {
        workflowCount += 1;
      }
    }
  };
  await visit(root);
  return { extCounts, lowerNames, workflowCount };
}

function buildLangHits(extCounts) {
  const hits = {};
  for (const [lang, exts] of Object.entries(LANGUAGE_EXTENSIONS)) {
    const matched = exts.filter((ext) => extCounts.has(ext));
    if (!matched.length) continue;
    const count = matched.reduce((sum, ext) => sum + (extCounts.get(ext) || 0), 0);
    hits[lang] = { extensions: matched, files: count };
  }
  return hits;
}

function buildFormatHits(extCounts, lowerNames, workflowCount) {
  const hits = {};
  const hasPrefixName = (prefix) => {
    const key = prefix.toLowerCase();
    if (lowerNames.has(key)) return true;
    for (const name of lowerNames) {
      if (name.startsWith(key)) return true;
    }
    return false;
  };
  for (const [format, exts] of Object.entries(FORMAT_EXTENSIONS)) {
    const matched = exts.filter((ext) => extCounts.has(ext));
    if (!matched.length) continue;
    const count = matched.reduce((sum, ext) => sum + (extCounts.get(ext) || 0), 0);
    hits[format] = { extensions: matched, files: count };
  }
  for (const [format, names] of Object.entries(FORMAT_FILENAMES)) {
    const prefixes = FORMAT_FILENAME_PREFIXES[format] || [];
    const hasExact = names.some((name) => lowerNames.has(name));
    const hasPrefix = prefixes.some((prefix) => hasPrefixName(prefix));
    if (hasExact || hasPrefix) {
      hits[format] = { filenames: names, files: names.length };
    }
  }
  if (workflowCount) {
    hits['github-actions'] = { extensions: ['.yml', '.yaml'], files: workflowCount };
  }
  return hits;
}

export async function detectRepoLanguages(root) {
  const { extCounts, lowerNames, workflowCount } = await scanRepo(root);
  const languages = buildLangHits(extCounts);
  const formats = buildFormatHits(extCounts, lowerNames, workflowCount);
  return { languages, formats, extCounts };
}

export function getToolingRegistry(toolingRoot, repoRoot) {
  const nodeDir = path.join(toolingRoot, 'node');
  const nodeBin = path.join(nodeDir, 'node_modules', '.bin');
  const repoNodeBin = path.join(repoRoot, 'node_modules', '.bin');
  const binDir = path.join(toolingRoot, 'bin');
  const dotnetDir = path.join(toolingRoot, 'dotnet');
  const gemsDir = path.join(toolingRoot, 'gems');
  const composerDir = path.join(toolingRoot, 'composer');
  const composerBin = path.join(composerDir, 'vendor', 'bin');

  return [
    {
      id: 'tsserver',
      label: 'TypeScript server',
      languages: ['typescript'],
      detect: { cmd: 'tsserver', args: ['--version'], binDirs: [repoNodeBin, nodeBin] },
      install: {
        cache: { cmd: 'npm', args: ['install', '--prefix', nodeDir, 'typescript'] },
        user: { cmd: 'npm', args: ['install', '-g', 'typescript'] }
      },
      docs: TOOL_DOCS.tsserver
    },
    {
      id: 'typescript-language-server',
      label: 'TypeScript language server',
      languages: ['typescript'],
      detect: { cmd: 'typescript-language-server', args: ['--version'], binDirs: [repoNodeBin, nodeBin] },
      install: {
        cache: { cmd: 'npm', args: ['install', '--prefix', nodeDir, 'typescript-language-server'] },
        user: { cmd: 'npm', args: ['install', '-g', 'typescript-language-server'] }
      },
      docs: TOOL_DOCS['typescript-language-server']
    },
    {
      id: 'clangd',
      label: 'clangd',
      languages: ['c', 'cpp', 'objc'],
      detect: { cmd: 'clangd', args: ['--version'], binDirs: [] },
      install: {
        manual: true
      },
      docs: TOOL_DOCS.clangd
    },
    {
      id: 'sourcekit-lsp',
      label: 'SourceKit-LSP',
      languages: ['swift'],
      detect: { cmd: 'sourcekit-lsp', args: ['--help'], binDirs: [] },
      install: {
        manual: true
      },
      docs: TOOL_DOCS['sourcekit-lsp']
    },
    {
      id: 'pyright',
      label: 'Pyright',
      languages: ['python'],
      detect: { cmd: 'pyright', args: ['--version'], binDirs: [repoNodeBin, nodeBin] },
      install: {
        cache: { cmd: 'npm', args: ['install', '--prefix', nodeDir, 'pyright'] },
        user: { cmd: 'npm', args: ['install', '-g', 'pyright'] }
      },
      docs: TOOL_DOCS.pyright
    },
    {
      id: 'rust-analyzer',
      label: 'rust-analyzer',
      languages: ['rust'],
      detect: { cmd: 'rust-analyzer', args: ['--version'], binDirs: [] },
      install: {
        user: { cmd: 'rustup', args: ['component', 'add', 'rust-analyzer'], requires: 'rustup' }
      },
      docs: TOOL_DOCS['rust-analyzer']
    },
    {
      id: 'gopls',
      label: 'gopls',
      languages: ['go'],
      detect: { cmd: 'gopls', args: ['version'], binDirs: [binDir] },
      install: {
        cache: { cmd: 'go', args: ['install', 'golang.org/x/tools/gopls@latest'], env: { GOBIN: binDir }, requires: 'go' },
        user: { cmd: 'go', args: ['install', 'golang.org/x/tools/gopls@latest'], requires: 'go' }
      },
      docs: TOOL_DOCS.gopls
    },
    {
      id: 'jdtls',
      label: 'jdtls',
      languages: ['java'],
      detect: { cmd: 'jdtls', args: ['-version'], binDirs: [] },
      install: {
        manual: true
      },
      docs: TOOL_DOCS.jdtls
    },
    {
      id: 'kotlin-language-server',
      label: 'kotlin-language-server',
      languages: ['kotlin'],
      detect: { cmd: 'kotlin-language-server', args: ['--version'], binDirs: [] },
      install: {
        manual: true
      },
      docs: TOOL_DOCS['kotlin-language-server']
    },
    {
      id: 'kotlin-lsp',
      label: 'Kotlin LSP',
      languages: ['kotlin'],
      detect: { cmd: 'kotlin-lsp', args: ['--version'], binDirs: [] },
      install: {
        manual: true
      },
      docs: TOOL_DOCS['kotlin-lsp']
    },
    {
      id: 'omnisharp',
      label: 'OmniSharp',
      languages: ['csharp'],
      detect: { cmd: 'omnisharp', args: ['--version'], binDirs: [dotnetDir] },
      install: {
        cache: { cmd: 'dotnet', args: ['tool', 'install', '--tool-path', dotnetDir, 'omnisharp'], requires: 'dotnet' },
        user: { cmd: 'dotnet', args: ['tool', 'install', '-g', 'omnisharp'], requires: 'dotnet' }
      },
      docs: TOOL_DOCS.omnisharp
    },
    {
      id: 'csharp-ls',
      label: 'C# LSP (Roslyn)',
      languages: ['csharp'],
      detect: { cmd: 'csharp-ls', args: ['--version'], binDirs: [dotnetDir] },
      install: {
        cache: { cmd: 'dotnet', args: ['tool', 'install', '--tool-path', dotnetDir, 'csharp-ls'], requires: 'dotnet' },
        user: { cmd: 'dotnet', args: ['tool', 'install', '-g', 'csharp-ls'], requires: 'dotnet' }
      },
      docs: TOOL_DOCS['csharp-ls']
    },
    {
      id: 'ruby-lsp',
      label: 'Ruby LSP',
      languages: ['ruby'],
      detect: { cmd: 'ruby-lsp', args: ['--version'], binDirs: [binDir] },
      install: {
        cache: { cmd: 'gem', args: ['install', '-i', gemsDir, '-n', binDir, 'ruby-lsp'], requires: 'gem' },
        user: { cmd: 'gem', args: ['install', 'ruby-lsp'], requires: 'gem' }
      },
      docs: TOOL_DOCS['ruby-lsp']
    },
    {
      id: 'solargraph',
      label: 'Solargraph',
      languages: ['ruby'],
      detect: { cmd: 'solargraph', args: ['--version'], binDirs: [binDir] },
      install: {
        cache: { cmd: 'gem', args: ['install', '-i', gemsDir, '-n', binDir, 'solargraph'], requires: 'gem' },
        user: { cmd: 'gem', args: ['install', 'solargraph'], requires: 'gem' }
      },
      docs: TOOL_DOCS.solargraph
    },
    {
      id: 'phpactor',
      label: 'phpactor',
      languages: ['php'],
      detect: { cmd: 'phpactor', args: ['--version'], binDirs: [composerBin] },
      install: {
        cache: { cmd: 'composer', args: ['global', 'require', 'phpactor/phpactor'], env: { COMPOSER_HOME: composerDir }, requires: 'composer' },
        user: { cmd: 'composer', args: ['global', 'require', 'phpactor/phpactor'], requires: 'composer' }
      },
      docs: TOOL_DOCS.phpactor
    },
    {
      id: 'intelephense',
      label: 'Intelephense',
      languages: ['php'],
      detect: { cmd: 'intelephense', args: ['--version'], binDirs: [repoNodeBin, nodeBin] },
      install: {
        cache: { cmd: 'npm', args: ['install', '--prefix', nodeDir, 'intelephense'] },
        user: { cmd: 'npm', args: ['install', '-g', 'intelephense'] }
      },
      docs: TOOL_DOCS.intelephense
    },
    {
      id: 'lua-language-server',
      label: 'lua-language-server',
      languages: ['lua'],
      detect: { cmd: 'lua-language-server', args: ['-v'], binDirs: [] },
      install: {
        manual: true
      },
      docs: TOOL_DOCS['lua-language-server']
    },
    {
      id: 'bash-language-server',
      label: 'bash-language-server',
      languages: ['shell'],
      detect: { cmd: 'bash-language-server', args: ['--version'], binDirs: [repoNodeBin, nodeBin] },
      install: {
        cache: { cmd: 'npm', args: ['install', '--prefix', nodeDir, 'bash-language-server'] },
        user: { cmd: 'npm', args: ['install', '-g', 'bash-language-server'] }
      },
      docs: TOOL_DOCS['bash-language-server']
    },
    {
      id: 'sqls',
      label: 'sqls',
      languages: ['sql'],
      detect: { cmd: 'sqls', args: ['version'], binDirs: [binDir] },
      install: {
        cache: { cmd: 'go', args: ['install', 'github.com/lighttiger2505/sqls@latest'], env: { GOBIN: binDir }, requires: 'go' },
        user: { cmd: 'go', args: ['install', 'github.com/lighttiger2505/sqls@latest'], requires: 'go' }
      },
      docs: TOOL_DOCS.sqls
    }
  ];
}

function filterToolsByConfig(tools, toolingConfig) {
  const enabled = Array.isArray(toolingConfig?.enabledTools) ? toolingConfig.enabledTools : [];
  const disabled = Array.isArray(toolingConfig?.disabledTools) ? toolingConfig.disabledTools : [];
  let filtered = tools;
  if (enabled.length) {
    const enabledSet = new Set(enabled);
    filtered = filtered.filter((tool) => enabledSet.has(tool.id));
  }
  if (disabled.length) {
    const disabledSet = new Set(disabled);
    filtered = filtered.filter((tool) => !disabledSet.has(tool.id));
  }
  return filtered;
}

export function resolveToolsForLanguages(languages, toolingRoot, repoRoot, toolingConfig = null) {
  const languageSet = new Set(languages);
  const registry = getToolingRegistry(toolingRoot, repoRoot);
  const matched = registry.filter((tool) => tool.languages.some((lang) => languageSet.has(lang)));
  return filterToolsByConfig(matched, toolingConfig);
}

export function resolveToolsById(ids, toolingRoot, repoRoot, toolingConfig = null) {
  const idSet = new Set(ids);
  const registry = getToolingRegistry(toolingRoot, repoRoot);
  const matched = registry.filter((tool) => idSet.has(tool.id));
  return filterToolsByConfig(matched, toolingConfig);
}

export function detectTool(tool) {
  const binDirs = tool.detect?.binDirs || [];
  const binPath = binDirs.length ? findBinaryInDirs(tool.detect.cmd, binDirs) : null;
  if (binPath) {
    const ok = canRun(binPath, tool.detect.args || ['--version']);
    if (ok) return { found: true, path: binPath, source: 'cache' };
  }
  const ok = canRun(tool.detect.cmd, tool.detect.args || ['--version']);
  if (ok) return { found: true, path: tool.detect.cmd, source: 'path' };
  return { found: false, path: null, source: null };
}

export function selectInstallPlan(tool, scope, allowFallback) {
  const install = tool.install || {};
  const normalizedScope = scope || 'cache';
  if (install[normalizedScope]) {
    return { scope: normalizedScope, plan: install[normalizedScope] };
  }
  if (!allowFallback) return { scope: normalizedScope, plan: null };
  const fallbackScope = install.cache ? 'cache' : (install.user ? 'user' : (install.system ? 'system' : null));
  if (!fallbackScope) return { scope: normalizedScope, plan: null };
  return { scope: fallbackScope, plan: install[fallbackScope], fallback: true };
}

export function hasCommand(cmd) {
  return canRun(cmd, ['--version']);
}

export async function buildToolingReport(root, languageOverride = null, options = {}) {
  const toolingConfig = getToolingConfig(root);
  const skipScan = options.skipScan === true;
  const detected = skipScan ? { languages: {}, formats: {} } : await detectRepoLanguages(root);
  const languages = detected.languages || {};
  const formats = detected.formats || {};
  const languageList = languageOverride && languageOverride.length
    ? languageOverride
    : Object.keys(languages);
  const languageMap = (languageOverride && languageOverride.length && skipScan)
    ? languageOverride.reduce((acc, lang) => {
      acc[lang] = { extensions: [], files: 0, override: true };
      return acc;
    }, {})
    : languages;
  const tools = resolveToolsForLanguages(languageList, toolingConfig.dir, root, toolingConfig).map((tool) => {
    const status = detectTool(tool);
    return {
      id: tool.id,
      label: tool.label,
      docs: tool.docs,
      languages: tool.languages,
      found: status.found,
      source: status.source,
      path: status.path,
      install: tool.install || {}
    };
  });
  return {
    root,
    toolingRoot: toolingConfig.dir,
    languages: languageMap,
    formats,
    tools
  };
}

export function normalizeLanguageList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}
