#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
const searchPath = path.join(root, 'search.js');
const cacheRoot = path.join(root, 'tests', '.cache', 'language-fidelity');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';
const repoArgs = ['--repo', fixtureRoot];

function run(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: fixtureRoot,
    env,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

function runSearch(args, label) {
  const result = spawnSync(process.execPath, [...args, ...repoArgs], {
    cwd: fixtureRoot,
    env,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout || '';
}

run([path.join(root, 'build_index.js'), '--stub-embeddings', ...repoArgs], 'build index');

function hasPython() {
  const candidates = ['python', 'python3'];
  for (const cmd of candidates) {
    const result = spawnSync(cmd, ['-c', 'import sys; sys.stdout.write("ok")'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim() === 'ok') return true;
  }
  return false;
}
const pythonAvailable = hasPython();

const userConfig = loadUserConfig(fixtureRoot);
const codeDir = getIndexDir(fixtureRoot, 'code', userConfig);
const chunkMetaPath = path.join(codeDir, 'chunk_meta.json');
if (!fs.existsSync(chunkMetaPath)) {
  console.error(`Missing chunk meta at ${chunkMetaPath}`);
  process.exit(1);
}

const chunkMeta = JSON.parse(fs.readFileSync(chunkMetaPath, 'utf8'));
const fileRelationsPath = path.join(codeDir, 'file_relations.json');
let fileRelations = null;
if (fs.existsSync(fileRelationsPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(fileRelationsPath, 'utf8'));
    if (Array.isArray(raw)) {
      fileRelations = new Map();
      raw.forEach((entry) => {
        if (entry?.file) fileRelations.set(entry.file, entry.relations || null);
      });
    }
  } catch {}
}
const getFileRelations = (file) => (fileRelations?.get(file) || null);

function findChunk(match) {
  return chunkMeta.find((chunk) => {
    if (!chunk || !chunk.file) return false;
    if (match.file && chunk.file !== match.file) return false;
    if (match.kind && chunk.kind !== match.kind) return false;
    if (match.nameIncludes && !String(chunk.name || '').includes(match.nameIncludes)) return false;
    return true;
  });
}

const failures = [];

const branchSearch = runSearch(
  [searchPath, 'load', '--json', '--mode', 'code', '--branches', '1', '--no-ann'],
  'search (branches filter)'
);
let branchPayload = null;
try {
  branchPayload = JSON.parse(branchSearch);
} catch {
  failures.push('Search filter test failed: invalid JSON output.');
}
if (branchPayload) {
  const branchHits = branchPayload.code || [];
  if (!branchHits.length) {
    failures.push('Search filter test failed: no results for branches >= 1.');
  } else {
    const hasBranch = branchHits.some((hit) => (hit.docmeta?.controlFlow?.branches || 0) >= 1);
    if (!hasBranch) {
      failures.push('Search filter test failed: hits missing controlFlow.branches.');
    }
  }
}

const inferredSearch = runSearch(
  [searchPath, 'makeWidget', '--json', '--mode', 'code', '--inferred-type', 'object', '--no-ann'],
  'search (inferred type filter)'
);
let inferredPayload = null;
try {
  inferredPayload = JSON.parse(inferredSearch);
} catch {
  failures.push('Search inferred-type test failed: invalid JSON output.');
}
if (inferredPayload) {
  const inferredHits = inferredPayload.code || [];
  if (!inferredHits.length) {
    failures.push('Search inferred-type test failed: no results for object.');
  }
}

const returnTypeSearch = runSearch(
  [searchPath, 'makeWidget', '--json', '--mode', 'code', '--return-type', 'Widget', '--no-ann'],
  'search (return-type filter)'
);
let returnTypePayload = null;
try {
  returnTypePayload = JSON.parse(returnTypeSearch);
} catch {
  failures.push('Search return-type test failed: invalid JSON output.');
}
if (returnTypePayload) {
  const returnHits = returnTypePayload.code || [];
  if (!returnHits.length) {
    failures.push('Search return-type test failed: no results for Widget.');
  }
}

const returnsSearch = runSearch(
  [searchPath, 'update', '--json', '--mode', 'code', '--returns', '--no-ann'],
  'search (returns filter)'
);
let returnsPayload = null;
try {
  returnsPayload = JSON.parse(returnsSearch);
} catch {
  failures.push('Search returns filter failed: invalid JSON output.');
}
if (returnsPayload) {
  const returnHits = returnsPayload.code || [];
  if (!returnHits.length) {
    failures.push('Search returns filter failed: no results for update.');
  }
}

const asyncSearch = runSearch(
  [searchPath, 'load', '--json', '--mode', 'code', '--async', '--no-ann'],
  'search (async filter)'
);
let asyncPayload = null;
try {
  asyncPayload = JSON.parse(asyncSearch);
} catch {
  failures.push('Search async filter failed: invalid JSON output.');
}
if (asyncPayload) {
  const asyncHits = asyncPayload.code || [];
  if (!asyncHits.length) {
    failures.push('Search async filter failed: no results for load.');
  }
}

const aliasChunk = findChunk({ file: 'src/javascript_advanced.js', nameIncludes: 'buildAliases' });
if (!aliasChunk) {
  failures.push('Missing JavaScript alias chunk (buildAliases).');
} else {
  const aliases = aliasChunk.docmeta?.dataflow?.aliases || [];
  if (!aliases.includes('name=label') || !aliases.includes('copy=items')) {
    failures.push('JavaScript alias tracking missing expected aliases for buildAliases.');
  }
  const inferredLocals = aliasChunk.docmeta?.inferredTypes?.locals?.copy || [];
  if (!inferredLocals.some((entry) => entry.type === 'array')) {
    failures.push('JavaScript inferredTypes missing array for copy alias.');
  }
}

const goDocChunk = findChunk({ file: 'src/go_advanced.go', kind: 'StructDeclaration', nameIncludes: 'Widget' });
if (!goDocChunk) {
  failures.push('Missing Go struct chunk (Widget).');
} else if (!String(goDocChunk.docmeta?.doc || '').includes('Widget holds a name')) {
  failures.push('Go docstring missing for Widget struct.');
}

const perlDocChunk = findChunk({ file: 'src/perl_advanced.pl', kind: 'FunctionDeclaration', nameIncludes: 'greet' });
if (!perlDocChunk) {
  failures.push('Missing Perl function chunk (greet).');
} else if (!String(perlDocChunk.docmeta?.doc || '').includes('Greets a caller')) {
  failures.push('Perl docstring missing for greet.');
}

const sqlDocChunk = findChunk({ file: 'src/sql_advanced.sql', kind: 'TableDeclaration', nameIncludes: 'widgets' });
if (!sqlDocChunk) {
  failures.push('Missing SQL table chunk (widgets).');
} else if (!String(sqlDocChunk.docmeta?.doc || '').includes('Widget table')) {
  failures.push('SQL docstring missing for widgets.');
}

const riskChunk = findChunk({ file: 'src/javascript_risk.js', nameIncludes: 'runCommand' });
if (!riskChunk) {
  failures.push('Missing JavaScript risk chunk (runCommand).');
} else {
  const risk = riskChunk.docmeta?.risk;
  if (!risk || !Array.isArray(risk.tags) || !risk.tags.includes('command-exec')) {
    failures.push('Risk tags missing command-exec for runCommand.');
  }
  const flowMatch = (risk?.flows || []).some(
    (flow) => flow.source === 'req.body' && flow.sink === 'exec'
  );
  if (!flowMatch) {
    failures.push('Risk flows missing req.body->exec for runCommand.');
  }
}

const crossFileRisk = findChunk({ file: 'src/javascript_risk_source.js', nameIncludes: 'handleRequest' });
if (!crossFileRisk) {
  failures.push('Missing cross-file risk chunk (handleRequest).');
} else {
  const flows = crossFileRisk.docmeta?.risk?.flows || [];
  const crossFlow = flows.some(
    (flow) => flow.source === 'req.body' && flow.sink === 'exec' && flow.scope === 'cross-file'
  );
  if (!crossFlow) {
    failures.push('Cross-file risk flow missing req.body->exec for handleRequest.');
  }
}

const riskSearch = runSearch(
  [searchPath, 'exec', '--json', '--mode', 'code', '--risk', 'command-exec', '--no-ann'],
  'search (risk filter)'
);
let riskPayload = null;
try {
  riskPayload = JSON.parse(riskSearch);
} catch {
  failures.push('Search risk filter failed: invalid JSON output.');
}
if (riskPayload) {
  const riskHits = riskPayload.code || [];
  if (!riskHits.length) {
    failures.push('Search risk filter failed: no results for command-exec.');
  }
}

const flowSearch = runSearch(
  [searchPath, 'req', '--json', '--mode', 'code', '--risk-flow', 'req.body->exec', '--no-ann'],
  'search (risk flow filter)'
);
let flowPayload = null;
try {
  flowPayload = JSON.parse(flowSearch);
} catch {
  failures.push('Search risk flow filter failed: invalid JSON output.');
}
if (flowPayload) {
  const flowHits = flowPayload.code || [];
  if (!flowHits.length) {
    failures.push('Search risk flow filter failed: no results for req.body->exec.');
  }
}

if (pythonAvailable) {
  const pointChunk = findChunk({ file: 'src/python_advanced.py', kind: 'ClassDeclaration', nameIncludes: 'Point' });
  if (!pointChunk) {
    failures.push('Missing Python dataclass chunk (Point).');
  } else {
    const fields = pointChunk.docmeta?.fields || [];
    const fieldNames = fields.map((field) => field.name);
    if (!fieldNames.includes('x') || !fieldNames.includes('y')) {
      failures.push('Python dataclass fields missing for Point (expected x,y).');
    }
  }

  if (!findChunk({ file: 'src/python_advanced.py', nameIncludes: 'outer.inner' })) {
    failures.push('Missing nested function chunk (outer.inner).');
  }

  if (!findChunk({ file: 'src/python_advanced.py', nameIncludes: 'Point.distance.sq' })) {
    failures.push('Missing nested method helper chunk (Point.distance.sq).');
  }

  const updateState = findChunk({ file: 'src/python_advanced.py', nameIncludes: 'update_state' });
  if (!updateState) {
    failures.push('Missing Python dataflow chunk (update_state).');
  } else {
    const mutations = updateState.docmeta?.dataflow?.mutations || [];
    if (!mutations.some((name) => name === 'state[]')) {
      failures.push('Python dataflow missing state[] mutation.');
    }
    const throws = updateState.docmeta?.throws || [];
    if (!throws.some((name) => String(name).includes('ValueError'))) {
      failures.push('Python throws metadata missing ValueError for update_state.');
    }
    if (!updateState.docmeta?.returnsValue) {
      failures.push('Python returnsValue missing for update_state.');
    }
    const controlFlow = updateState.docmeta?.controlFlow;
    if (!controlFlow || !(controlFlow.branches >= 1)) {
      failures.push('Python controlFlow missing branches for update_state.');
    }
    const inferredState = updateState.docmeta?.inferredTypes?.params?.state || [];
    if (!inferredState.some((entry) => entry.type === 'dict')) {
      failures.push('Python inferredTypes missing state: dict.');
    }
  }

  const fetchData = findChunk({ file: 'src/python_advanced.py', nameIncludes: 'fetch_data' });
  if (!fetchData) {
    failures.push('Missing Python async chunk (fetch_data).');
  } else {
    if (!fetchData.docmeta?.async) {
      failures.push('Python async metadata missing for fetch_data.');
    }
    const awaits = fetchData.docmeta?.awaits || [];
    if (!awaits.some((name) => name === 'client.fetch')) {
      failures.push('Python await metadata missing client.fetch.');
    }
  }
} else {
  console.log('Skipping Python AST checks (python not available).');
}

const jsWidgetClass = chunkMeta.find((chunk) => {
  if (!chunk || chunk.file !== 'src/javascript_advanced.js') return false;
  if (chunk.name !== 'Widget') return false;
  return chunk.kind === 'ClassDeclaration' ||
    chunk.kind === 'ExportedClass' ||
    chunk.kind === 'ExportDefaultClassDeclaration';
});
if (!jsWidgetClass) {
  failures.push('Missing JS class chunk (Widget).');
} else {
  const bases = jsWidgetClass.docmeta?.extends || [];
  if (!bases.includes('BaseWidget')) {
    failures.push('JS class metadata missing BaseWidget extends.');
  }
}

const jsMakeWidget = findChunk({ file: 'src/javascript_advanced.js', nameIncludes: 'makeWidget' });
if (!jsMakeWidget) {
  failures.push('Missing JS function chunk (makeWidget).');
} else {
  const signature = jsMakeWidget.docmeta?.signature || '';
  if (!signature.includes('makeWidget')) {
    failures.push('JS docmeta missing signature for makeWidget.');
  }
  const paramDefaults = jsMakeWidget.docmeta?.paramDefaults || {};
  if (!Object.prototype.hasOwnProperty.call(paramDefaults, 'opts')) {
    failures.push('JS docmeta missing default param for makeWidget (opts).');
  }
  const inferredOpts = jsMakeWidget.docmeta?.inferredTypes?.params?.opts || [];
  if (!inferredOpts.some((entry) => entry.type === 'object')) {
    failures.push('JS inferredTypes missing opts: object.');
  }
}

const jsLoad = findChunk({ file: 'src/javascript_advanced.js', nameIncludes: 'Widget.load' });
if (!jsLoad) {
  failures.push('Missing JS async method chunk (Widget.load).');
} else {
  if (!jsLoad.docmeta?.modifiers?.async) {
    failures.push('JS async modifier missing for Widget.load.');
  }
  const awaits = jsLoad.docmeta?.awaits || [];
  if (!awaits.some((name) => name === 'fetchData')) {
    failures.push('JS dataflow missing awaited fetchData call.');
  }
  const throws = jsLoad.docmeta?.throws || [];
  if (!throws.some((name) => name === 'Error')) {
    failures.push('JS throws metadata missing Error for Widget.load.');
  }
  const controlFlow = jsLoad.docmeta?.controlFlow;
  if (!controlFlow || !(controlFlow.branches >= 1)) {
    failures.push('JS controlFlow missing branches for Widget.load.');
  }
  if (!controlFlow || !(controlFlow.awaits >= 1)) {
    failures.push('JS controlFlow missing awaits for Widget.load.');
  }
}

const jsUpdate = findChunk({ file: 'src/javascript_advanced.js', nameIncludes: 'Widget.update' });
if (!jsUpdate) {
  failures.push('Missing JS method chunk (Widget.update).');
} else {
  const mutations = jsUpdate.docmeta?.dataflow?.mutations || [];
  if (!mutations.some((name) => name === 'this.count')) {
    failures.push('JS dataflow missing mutation for this.count.');
  }
}

if (!findChunk({ file: 'src/swift_advanced.swift', kind: 'MethodDeclaration', nameIncludes: 'Box.isEqual' })) {
  failures.push('Missing Swift extension method chunk (Box.isEqual).');
}

const boxChunk = findChunk({ file: 'src/swift_advanced.swift', kind: 'StructDeclaration', nameIncludes: 'Box' });
if (!boxChunk) {
  failures.push('Missing Swift generic struct chunk (Box).');
} else {
  const generics = boxChunk.docmeta?.generics || [];
  if (!generics.includes('T')) {
    failures.push('Swift generics missing for Box (expected T).');
  }
}

const boxExtension = findChunk({ file: 'src/swift_advanced.swift', kind: 'ExtensionDeclaration', nameIncludes: 'Box' });
if (!boxExtension) {
  failures.push('Missing Swift extension declaration chunk (Box).');
} else {
  const whereClause = boxExtension.docmeta?.whereClause || '';
  if (!whereClause.includes('T: Equatable')) {
    failures.push('Swift extension where clause missing (expected T: Equatable).');
  }
}

const objcMethod = findChunk({ file: 'src/objc_advanced.m', kind: 'MethodDeclaration', nameIncludes: 'OCGreeter.objcGreet' });
if (!objcMethod) {
  failures.push('Missing ObjC method chunk (OCGreeter.objcGreet:).');
}

const objcCaller = findChunk({ file: 'src/objc_advanced.m', kind: 'FunctionDeclaration', nameIncludes: 'use_add_numbers' });
if (!objcCaller) {
  failures.push('Missing ObjC/C helper function chunk (use_add_numbers).');
} else {
  const calls = objcCaller.codeRelations?.calls || [];
  if (!calls.some(([, callee]) => callee === 'add_numbers')) {
    failures.push('ObjC/C call graph missing add_numbers call.');
  }
}

if (!findChunk({ file: 'src/rust_advanced.rs', kind: 'MethodDeclaration', nameIncludes: 'Widget.render' })) {
  failures.push('Missing Rust method chunk (Widget.render).');
}

if (!findChunk({ file: 'src/rust_advanced.rs', kind: 'MethodDeclaration', nameIncludes: 'Widget.new' })) {
  failures.push('Missing Rust impl method chunk (Widget.new).');
}

if (!findChunk({ file: 'src/rust_advanced.rs', kind: 'MacroDeclaration', nameIncludes: 'make_widget' })) {
  failures.push('Missing Rust macro chunk (make_widget).');
}

if (!findChunk({ file: 'src/cpp_advanced.cpp', kind: 'FunctionDeclaration', nameIncludes: 'addValues' })) {
  failures.push('Missing C++ template function chunk (addValues).');
}

const cppCaller = findChunk({ file: 'src/cpp_advanced.cpp', kind: 'FunctionDeclaration', nameIncludes: 'useAdd' });
if (!cppCaller) {
  failures.push('Missing C++ helper function chunk (useAdd).');
} else {
  const calls = cppCaller.codeRelations?.calls || [];
  if (!calls.some(([, callee]) => callee === 'addValues')) {
    failures.push('C++ call graph missing addValues call.');
  }
  const controlFlow = cppCaller.docmeta?.controlFlow;
  if (!controlFlow || !(controlFlow.returns >= 1)) {
    failures.push('C++ controlFlow missing returns for useAdd.');
  }
}

const goMethod = findChunk({ file: 'src/go_advanced.go', kind: 'MethodDeclaration', nameIncludes: 'Widget.Render' });
if (!goMethod) {
  failures.push('Missing Go method chunk (Widget.Render).');
}

const goFunc = findChunk({ file: 'src/go_advanced.go', kind: 'FunctionDeclaration', nameIncludes: 'MakeWidget' });
if (!goFunc) {
  failures.push('Missing Go function chunk (MakeWidget).');
} else {
  const calls = goFunc.codeRelations?.calls || [];
  if (!calls.some(([, callee]) => callee === 'strings.TrimSpace' || callee === 'TrimSpace')) {
    failures.push('Go call graph missing strings.TrimSpace call.');
  }
  const controlFlow = goFunc.docmeta?.controlFlow;
  if (!controlFlow || !(controlFlow.returns >= 1)) {
    failures.push('Go controlFlow missing returns for MakeWidget.');
  }
}

const javaMethod = findChunk({ file: 'src/java_advanced.java', kind: 'MethodDeclaration', nameIncludes: 'Box.add' });
if (!javaMethod) {
  failures.push('Missing Java method chunk (Box.add).');
} else {
  const imports = javaMethod.codeRelations?.imports || getFileRelations(javaMethod.file)?.imports || [];
  if (!imports.some((imp) => imp === 'java.util.List')) {
    failures.push('Java import capture missing java.util.List.');
  }
}

const javaSize = findChunk({ file: 'src/java_advanced.java', kind: 'MethodDeclaration', nameIncludes: 'Box.size' });
if (!javaSize) {
  failures.push('Missing Java method chunk (Box.size).');
} else {
  const controlFlow = javaSize.docmeta?.controlFlow;
  if (!controlFlow || !(controlFlow.returns >= 1)) {
    failures.push('Java controlFlow missing returns for Box.size.');
  }
}

const perlSub = findChunk({ file: 'src/perl_advanced.pl', kind: 'FunctionDeclaration', nameIncludes: 'encode_payload' });
if (!perlSub) {
  failures.push('Missing Perl sub chunk (encode_payload).');
} else {
  const calls = perlSub.codeRelations?.calls || [];
  if (!calls.some(([, callee]) => callee === 'JSON::PP::encode_json' || callee === 'encode_json')) {
    failures.push('Perl call graph missing JSON::PP::encode_json call.');
  }
}

const shellFunc = findChunk({ file: 'src/shell_advanced.sh', kind: 'FunctionDeclaration', nameIncludes: 'build_index' });
if (!shellFunc) {
  failures.push('Missing shell function chunk (build_index).');
} else {
  const calls = shellFunc.codeRelations?.calls || [];
  if (!calls.some(([, callee]) => callee === 'grep')) {
    failures.push('Shell call graph missing grep call.');
  }
  if (!shellFunc.docmeta?.controlFlow) {
    failures.push('Shell controlFlow metadata missing for build_index.');
  }
}

const tsClass = chunkMeta.find((chunk) =>
  chunk.file === 'src/typescript_advanced.ts' &&
  chunk.kind === 'ClassDeclaration' &&
  chunk.name === 'Widget'
);
if (!tsClass) {
  failures.push('Missing TypeScript class chunk (Widget).');
} else {
  const extendsList = tsClass.docmeta?.extends || [];
  if (!extendsList.some((name) => name.includes('BaseWidget'))) {
    failures.push('TypeScript extends metadata missing BaseWidget.');
  }
}

const tsFunc = findChunk({ file: 'src/typescript_advanced.ts', kind: 'FunctionDeclaration', nameIncludes: 'makeWidget' });
if (!tsFunc) {
  failures.push('Missing TypeScript function chunk (makeWidget).');
} else {
  const controlFlow = tsFunc.docmeta?.controlFlow;
  if (!controlFlow || !(controlFlow.returns >= 1)) {
    failures.push('TypeScript controlFlow missing returns for makeWidget.');
  }
}

const tsAlias = findChunk({ file: 'src/typescript_advanced.ts', kind: 'FunctionDeclaration', nameIncludes: 'buildWidgetAliases' });
if (!tsAlias) {
  failures.push('Missing TypeScript alias chunk (buildWidgetAliases).');
} else {
  const tsAliases = tsAlias.docmeta?.dataflow?.aliases || [];
  if (!tsAliases.includes('name=label') || !tsAliases.includes('copy=items')) {
    failures.push('TypeScript alias tracking missing expected aliases for buildWidgetAliases.');
  }
  const inferredParams = tsAlias.docmeta?.inferredTypes?.params?.label || [];
  if (!inferredParams.some((entry) => entry.type === 'string')) {
    failures.push('TypeScript inferredTypes missing string for label param.');
  }
  if (!inferredParams.some((entry) => entry.type === 'null')) {
    failures.push('TypeScript inferredTypes missing null for label param.');
  }
  const inferredReturns = tsAlias.docmeta?.inferredTypes?.returns || [];
  if (!inferredReturns.some((entry) => entry.type === 'Array')) {
    failures.push('TypeScript inferredTypes missing Array return for buildWidgetAliases.');
  }
  const inferredLocals = tsAlias.docmeta?.inferredTypes?.locals?.copy || [];
  if (!inferredLocals.some((entry) => entry.type === 'array')) {
    failures.push('TypeScript inferredTypes missing array for copy alias.');
  }
}

const csharpMethod = findChunk({ file: 'src/csharp_advanced.cs', kind: 'MethodDeclaration', nameIncludes: 'Widget.Render' });
if (!csharpMethod) {
  failures.push('Missing C# method chunk (Widget.Render).');
}

const kotlinMethod = findChunk({ file: 'src/kotlin_advanced.kt', kind: 'MethodDeclaration', nameIncludes: 'Widget.render' });
if (!kotlinMethod) {
  failures.push('Missing Kotlin method chunk (Widget.render).');
}

const rubyMethod = findChunk({ file: 'src/ruby_advanced.rb', kind: 'MethodDeclaration', nameIncludes: 'Widget.render' });
if (!rubyMethod) {
  failures.push('Missing Ruby method chunk (Widget.render).');
}

const phpMethod = findChunk({ file: 'src/php_advanced.php', kind: 'MethodDeclaration', nameIncludes: 'Widget.render' });
if (!phpMethod) {
  failures.push('Missing PHP method chunk (Widget.render).');
}

const luaMethod = findChunk({ file: 'src/lua_advanced.lua', kind: 'MethodDeclaration', nameIncludes: 'Widget.render' });
if (!luaMethod) {
  failures.push('Missing Lua method chunk (Widget.render).');
}

const sqlTable = findChunk({ file: 'src/sql_advanced.sql', kind: 'TableDeclaration', nameIncludes: 'widgets' });
if (!sqlTable) {
  failures.push('Missing SQL table chunk (widgets).');
} else {
  if (!Array.isArray(sqlTable.docmeta?.dataflow?.reads)) {
    failures.push('SQL dataflow missing for widgets.');
  }
  if (typeof sqlTable.docmeta?.controlFlow?.branches !== 'number') {
    failures.push('SQL control flow missing for widgets.');
  }
}

const pgTable = findChunk({ file: 'src/sql_postgres.psql', kind: 'TableDeclaration', nameIncludes: 'pg_widgets' });
if (!pgTable) {
  failures.push('Missing Postgres SQL table chunk (pg_widgets).');
} else if (pgTable.docmeta?.dialect !== 'postgres') {
  failures.push('Postgres dialect metadata missing for pg_widgets.');
}

const mysqlTable = findChunk({ file: 'src/sql_mysql.mysql', kind: 'TableDeclaration', nameIncludes: 'mysql_widgets' });
if (!mysqlTable) {
  failures.push('Missing MySQL SQL table chunk (mysql_widgets).');
} else if (mysqlTable.docmeta?.dialect !== 'mysql') {
  failures.push('MySQL dialect metadata missing for mysql_widgets.');
}

const sqliteTable = findChunk({ file: 'src/sql_sqlite.sqlite', kind: 'TableDeclaration', nameIncludes: 'sqlite_widgets' });
if (!sqliteTable) {
  failures.push('Missing SQLite SQL table chunk (sqlite_widgets).');
} else if (sqliteTable.docmeta?.dialect !== 'sqlite') {
  failures.push('SQLite dialect metadata missing for sqlite_widgets.');
}

if (failures.length) {
  failures.forEach((msg) => console.error(msg));
  process.exit(1);
}

console.log('language fidelity test passed');
