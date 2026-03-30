import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { setupIncrementalRepo, ensureSqlitePaths } from '../../../helpers/sqlite-incremental.js';
import { runSqliteBuild } from '../../../helpers/sqlite-builder.js';

let DatabaseCtor = null;

const writeMinimalIncrementalFixture = async (repoRoot) => {
  await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await fsPromises.writeFile(
    path.join(repoRoot, 'src', 'index.js'),
    [
      'export function greet(name = "world") {',
      '  return `hello ${name}`;',
      '}',
      ''
    ].join('\n'),
    'utf8'
  );
  await fsPromises.writeFile(
    path.join(repoRoot, 'src', 'util.js'),
    [
      'export function utilValue() {',
      '  return 7;',
      '}',
      ''
    ].join('\n'),
    'utf8'
  );
  await fsPromises.writeFile(
    path.join(repoRoot, 'README.md'),
    '# Incremental sqlite fixture\n\nsmall synthetic fixture\n',
    'utf8'
  );
};

export const loadDatabaseCtorOrExit = async () => {
  if (DatabaseCtor) return DatabaseCtor;
  try {
    ({ default: DatabaseCtor } = await import('better-sqlite3'));
    return DatabaseCtor;
  } catch {
    console.error('better-sqlite3 is required for sqlite incremental tests.');
    process.exit(1);
  }
};

export const createIncrementalScenario = async ({
  name,
  mode = null,
  scmProvider = null
} = {}) => {
  const fixture = await setupIncrementalRepo({
    name,
    fixtureBuilder: writeMinimalIncrementalFixture,
    testConfig: {
      indexing: {
        scm: { provider: 'none' },
        typeInference: false,
        typeInferenceCrossFile: false,
        riskAnalysis: false,
        riskAnalysisCrossFile: false,
        embeddings: {
          enabled: false,
          mode: 'off',
          lancedb: { enabled: false },
          hnsw: { enabled: false }
        }
      },
      tooling: {
        autoEnableOnDetect: false,
        lsp: {
          enabled: false
        }
      }
    }
  });

  const runBuildIndex = ({ incremental = false } = {}) => {
    const args = [
      path.join(fixture.root, 'build_index.js'),
      '--incremental',
      '--stage',
      'stage1',
      '--stub-embeddings'
    ];
    if (mode) {
      args.push('--mode', mode);
    }
    if (scmProvider) {
      args.push('--scm-provider', scmProvider);
    }
    args.push('--repo', fixture.repoRoot);
    fixture.run(
      args,
      incremental ? 'build index (incremental)' : 'build index',
      { cwd: fixture.repoRoot, env: fixture.env, stdio: 'inherit' }
    );
  };

  const runBuildSqlite = async ({ incremental = false, logger = null } = {}) => runSqliteBuild(fixture.repoRoot, {
    mode: mode || 'all',
    incremental,
    logger
  });

  const resolveCodeDbPath = () => ensureSqlitePaths(fixture.repoRoot, fixture.userConfig).codePath;

  const openCodeDb = async ({ readonly = true } = {}) => {
    const Database = await loadDatabaseCtorOrExit();
    return new Database(resolveCodeDbPath(), { readonly });
  };

  return {
    ...fixture,
    runBuildIndex,
    runBuildSqlite,
    resolveCodeDbPath,
    openCodeDb
  };
};

export const appendFixtureExport = async (
  repoRoot,
  {
    relativePath = path.join('src', 'index.js'),
    source = '\nexport function farewell(name) {\n  return `bye ${name}`;\n}\n'
  } = {}
) => {
  const targetPath = path.join(repoRoot, relativePath);
  const original = await fsPromises.readFile(targetPath, 'utf8');
  const updated = `${original}${source}`;
  await fsPromises.writeFile(targetPath, updated);
  return { targetPath, original, updated };
};

export const runRepoSearchJson = ({
  root,
  repoRoot,
  env,
  query,
  backend = 'sqlite-fts',
  mode = null
}) => {
  const args = [path.join(root, 'search.js'), query, '--json', '--backend', backend];
  if (mode) {
    args.push('--mode', mode);
  }
  args.push('--repo', repoRoot);
  const result = spawnSync(
    process.execPath,
    args,
    { cwd: repoRoot, env, encoding: 'utf8' }
  );
  return {
    ...result,
    payload: JSON.parse(result.stdout || '{}')
  };
};
