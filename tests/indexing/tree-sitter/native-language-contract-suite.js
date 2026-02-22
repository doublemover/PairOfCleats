import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { runTreeSitterScheduler } from '../../../src/index/build/tree-sitter-scheduler/runner.js';
import { getUnavailableNativeGrammars } from './native-availability.js';

const toPosix = (value) => String(value || '').split(path.sep).join('/');
const toCanonicalGrammarKey = (value) => String(value || '')
  .trim()
  .replace(/~b\d+of\d+$/i, '');

export const NATIVE_LANGUAGE_CONTRACT_FIXTURES = Object.freeze([
  {
    languageId: 'javascript',
    file: 'sample.js',
    grammarKey: 'native:javascript',
    expectedNames: ['top', 'Foo', 'Foo.method'],
    content: `export function top(x) {
  return x + 1;
}

class Foo {
  method(a) {
    return a;
  }
}
`
  },
  {
    languageId: 'typescript',
    file: 'sample.ts',
    grammarKey: 'native:typescript',
    expectedNames: ['Contract', 'Widget', 'Widget.run', 'makeWidget'],
    content: `export interface Contract {
  run(): string;
}

export class Widget implements Contract {
  run(): string {
    return 'ok';
  }
}

export function makeWidget(name: string): Widget {
  return new Widget();
}
`
  },
  {
    languageId: 'typescript',
    file: 'sample.tsx',
    grammarKey: 'native:typescript',
    expectedNames: ['Props', 'Page'],
    content: `type Props = { title: string };

export function Page(props: Props) {
  return <main>{props.title}</main>;
}
`
  },
  {
    languageId: 'javascript',
    file: 'sample.jsx',
    grammarKey: 'native:javascript',
    expectedNames: ['App'],
    content: `export function App() {
  return <div>Hello</div>;
}
`
  },
  {
    languageId: 'python',
    file: 'sample.py',
    grammarKey: 'native:python',
    expectedNames: ['helper', 'Greeter', 'Greeter.message'],
    content: `def helper(value: int) -> int:
    return value + 1


class Greeter:
    @staticmethod
    def message(name: str) -> str:
        return f"hello {name}"
`
  },
  {
    languageId: 'json',
    file: 'sample.json',
    grammarKey: 'native:json',
    expectedNames: ['"feature"', '"threshold"'],
    content: `{
  "feature": true,
  "threshold": 0.42
}
`
  },
  {
    languageId: 'yaml',
    file: 'sample.yaml',
    grammarKey: 'native:yaml',
    expectedNames: ['database', 'host'],
    content: `database:
  host: localhost
  port: 5432
`
  },
  {
    languageId: 'toml',
    file: 'sample.toml',
    grammarKey: 'native:toml',
    expectedNames: ['host'],
    content: `[database]
host = "localhost"
port = 5432
`
  },
  {
    languageId: 'xml',
    file: 'sample.xml',
    grammarKey: 'native:xml',
    expectedNames: ['config', 'database'],
    content: `<config>
  <database host="localhost" port="5432">
    <pool size="5" />
  </database>
</config>
`
  },
  {
    languageId: 'markdown',
    file: 'sample.md',
    grammarKey: 'native:markdown',
    expectedNames: ['Sample Fixture'],
    content: `Inline heading sample: \`# Sample Fixture\`
`
  },
  {
    languageId: 'swift',
    file: 'sample.swift',
    grammarKey: 'native:swift',
    expectedNames: ['Widget', 'Widget.greet'],
    content: `class Widget {
  func greet(name: String) -> String {
    return name
  }
}
`
  },
  {
    languageId: 'kotlin',
    file: 'sample.kt',
    grammarKey: 'native:kotlin',
    expectedNames: ['Widget', 'Widget.greet'],
    content: `class Widget {
  fun greet(name: String): String {
    return name
  }
}
`
  },
  {
    languageId: 'csharp',
    file: 'sample.cs',
    grammarKey: 'native:csharp',
    expectedNames: ['Widget', 'Widget.Greet'],
    content: `namespace Demo {
  class Widget {
    string Greet(string name) {
      return name;
    }
  }
}
`
  },
  {
    languageId: 'clike',
    file: 'sample.c',
    grammarKey: 'native:clike',
    expectedNames: ['Widget', 'greet'],
    content: `struct Widget { int id; };

int greet(int name) {
  return name;
}
`
  },
  {
    languageId: 'cpp',
    file: 'sample.cpp',
    grammarKey: 'native:cpp',
    expectedNames: ['Widget', 'Widget.greet'],
    content: `class Widget {
public:
  int greet(int name) { return name; }
};
`
  },
  {
    languageId: 'objc',
    file: 'sample.m',
    grammarKey: 'native:objc',
    expectedNames: ['Widget', 'Widget.greet'],
    content: `@interface Widget : NSObject
- (void)greet:(NSString *)name;
@end

@implementation Widget
- (void)greet:(NSString *)name {
}
@end
`
  },
  {
    languageId: 'go',
    file: 'sample.go',
    grammarKey: 'native:go',
    expectedNames: ['Widget', 'Widget.Greet'],
    content: `type Widget struct {}

func (w Widget) Greet(name string) string {
  return name
}
`
  },
  {
    languageId: 'rust',
    file: 'sample.rs',
    grammarKey: 'native:rust',
    expectedNames: ['Widget', 'Widget.greet'],
    content: `struct Widget {}

impl Widget {
  fn greet(&self, name: &str) -> &str {
    name
  }
}
`
  },
  {
    languageId: 'java',
    file: 'sample.java',
    grammarKey: 'native:java',
    expectedNames: ['Widget', 'Widget.greet'],
    content: `class Widget {
  String greet(String name) {
    return name;
  }
}
`
  },
  {
    languageId: 'css',
    file: 'sample.css',
    grammarKey: 'native:css',
    expectedNames: ['.page-header'],
    content: `.page-header {
  display: flex;
}

@media screen and (max-width: 900px) {
  .page-header {
    flex-direction: column;
  }
}
`
  },
  {
    languageId: 'html',
    file: 'sample.html',
    grammarKey: 'native:html',
    expectedNames: ['html', 'body', 'main'],
    content: `<html>
  <body>
    <main id="app"></main>
  </body>
</html>
`
  }
]);

export async function runNativeLanguageContractSuite({
  root = process.cwd(),
  suiteName = 'tree-sitter-scheduler-native-language-contract'
} = {}) {
  const testRoot = path.join(root, '.testCache', suiteName);
  const fixtureDir = path.join(testRoot, 'fixtures');
  const outDir = path.join(testRoot, 'index-code');
  const fixtures = NATIVE_LANGUAGE_CONTRACT_FIXTURES.map((fixture) => ({
    ...fixture,
    abs: path.join(fixtureDir, fixture.file),
    containerPath: null
  }));
  const requiredLanguages = Array.from(new Set(fixtures.map((fixture) => fixture.languageId)));
  const { unavailable } = getUnavailableNativeGrammars(requiredLanguages);
  if (unavailable.length) {
    return {
      fixturesCovered: 0,
      grammarKeysCovered: 0,
      skipped: true,
      unavailable
    };
  }

  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(fixtureDir, { recursive: true });
  await fs.mkdir(outDir, { recursive: true });

  for (const fixture of fixtures) {
    fixture.containerPath = toPosix(path.relative(root, fixture.abs));
    await fs.writeFile(fixture.abs, fixture.content, 'utf8');
  }

  const runtime = {
    root,
    segmentsConfig: { inlineCodeSpans: true },
    languageOptions: {
      treeSitter: {
        enabled: true,
        strict: true
      }
    }
  };

  const scheduler = await runTreeSitterScheduler({
    mode: 'code',
    runtime,
    entries: fixtures.map((fixture) => fixture.abs),
    outDir,
    abortSignal: null,
    log: () => {}
  });

  assert.ok(scheduler, 'expected scheduler lookup');
  assert.ok(scheduler.index instanceof Map, 'expected scheduler index map');

  const rowsByFixture = new Map();
  for (const virtualPath of scheduler.index.keys()) {
    const row = await scheduler.loadRow(virtualPath);
    if (!row) continue;
    const key = `${row.containerPath}::${row.languageId}`;
    if (!rowsByFixture.has(key)) rowsByFixture.set(key, row);
  }

  for (const fixture of fixtures) {
    const key = `${fixture.containerPath}::${fixture.languageId}`;
    const row = rowsByFixture.get(key);
    assert.ok(row, `missing scheduler row for ${fixture.languageId} (${fixture.file})`);
    const actualCanonicalGrammarKey = toCanonicalGrammarKey(row.grammarKey);
    assert.equal(
      actualCanonicalGrammarKey,
      fixture.grammarKey,
      `unexpected grammar key for ${fixture.languageId} (${fixture.file})`
    );
    assert.equal(
      row.languageId,
      fixture.languageId,
      `unexpected language id for ${fixture.file}`
    );
    assert.equal(
      row.containerPath,
      fixture.containerPath,
      `unexpected containerPath for ${fixture.file}`
    );
    assert.ok(Array.isArray(row.chunks) && row.chunks.length > 0, `expected chunks for ${fixture.languageId}`);
    const nonFileChunks = row.chunks.filter((chunk) => chunk?.kind !== 'File');
    const fallbackOnly = nonFileChunks.length === 0;
    for (const chunk of row.chunks) {
      assert.ok(Number.isFinite(chunk?.start), `missing chunk.start for ${fixture.languageId}`);
      assert.ok(Number.isFinite(chunk?.end), `missing chunk.end for ${fixture.languageId}`);
      assert.ok(chunk.end > chunk.start, `invalid chunk range for ${fixture.languageId}`);
      assert.equal(typeof chunk?.kind, 'string', `missing chunk.kind for ${fixture.languageId}`);
      assert.ok(chunk.kind.trim().length > 0, `empty chunk.kind for ${fixture.languageId}`);
      assert.equal(typeof chunk?.name, 'string', `missing chunk.name for ${fixture.languageId}`);
      assert.ok(chunk.name.trim().length > 0, `empty chunk.name for ${fixture.languageId}`);
      assert.ok(chunk.meta && typeof chunk.meta === 'object', `missing chunk.meta for ${fixture.languageId}`);
      assert.ok(
        Number.isFinite(chunk.meta.startLine) && Number.isFinite(chunk.meta.endLine),
        `missing chunk line metadata for ${fixture.languageId}`
      );
      assert.ok(
        chunk.meta.endLine >= chunk.meta.startLine,
        `invalid chunk line metadata for ${fixture.languageId}`
      );
      assert.equal(
        typeof chunk.meta.signature,
        'string',
        `missing chunk signature metadata for ${fixture.languageId}`
      );
      assert.ok(
        chunk.meta.signature.trim().length > 0,
        `empty chunk signature metadata for ${fixture.languageId}`
      );
      assert.ok(
        chunk.meta.docstring == null || typeof chunk.meta.docstring === 'string',
        `invalid chunk docstring metadata for ${fixture.languageId}`
      );
    }
    if (!fallbackOnly) {
      const names = new Set(row.chunks.map((chunk) => chunk.name));
      for (const expectedName of fixture.expectedNames) {
        assert.ok(names.has(expectedName), `missing expected chunk "${expectedName}" for ${fixture.languageId}`);
      }
    }
  }

  const expectedGrammarKeys = new Set(fixtures.map((fixture) => fixture.grammarKey));
  const observedGrammarKeys = new Set();
  for (const row of rowsByFixture.values()) {
    const canonicalGrammarKey = toCanonicalGrammarKey(row?.grammarKey);
    if (canonicalGrammarKey) observedGrammarKeys.add(canonicalGrammarKey);
  }
  for (const grammarKey of expectedGrammarKeys) {
    assert.ok(observedGrammarKeys.has(grammarKey), `missing grammar key coverage for ${grammarKey}`);
  }

  return {
    fixturesCovered: fixtures.length,
    grammarKeysCovered: observedGrammarKeys.size,
    skipped: false,
    unavailable: []
  };
}
