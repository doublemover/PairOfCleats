# Your first search

Start with the [README](../../README.md) to install the source checkout. This guide
helps you choose a first build, validate its configuration and search the result.
Commands are run from the PairOfCleats checkout; replace
`"path/to/your-project"` with your target repository.

## Choose what to index

Build `code` first to search source files. Use `prose` for documentation,
`extracted-prose` for extracted text and `records` for normalized records.
You can add other modes later instead of starting with everything at once.

## A conservative first-run configuration

Create or merge the following into `.pairofcleats.json` in the target repository.
It keeps embedding execution and automatic tool installation off, uses modest
concurrency and leaves richer type inference for a later choice.

```json
{
  "threads": 1,
  "tooling": {
    "autoInstallOnDetect": false,
    "autoEnableOnDetect": false
  },
  "indexing": {
    "concurrency": 1,
    "ioConcurrencyCap": 1,
    "workerPool": {
      "enabled": false
    },
    "artifacts": {
      "writeConcurrency": 1
    },
    "scheduler": {
      "enabled": true,
      "cpuTokens": 1,
      "ioTokens": 1,
      "memoryTokens": 1,
      "lowResourceMode": true
    },
    "embeddings": {
      "enabled": false,
      "mode": "off"
    },
    "typeInference": false
  },
  "search": {
    "annDefault": false
  }
}
```

The thread/scheduler controls limit concurrent work; they are not a fixed RAM cap
for every repository or external process. This is a starting profile you can tune
after your first useful search. Richer type information and language services can
be enabled deliberately when you need them.

Check the config before building:

```sh
node bin/pairofcleats.js config validate --repo "path/to/your-project"
```

If you already have a project-specific configuration, preserve those settings and
merge only the choices you want. The [configuration reference](../config/contract.md)
and [schema](../config/schema.json) describe supported keys.

## Build and check the code index

```sh
node bin/pairofcleats.js index build --repo "path/to/your-project" --mode code --threads 1 --no-sqlite
node bin/pairofcleats.js index validate --repo "path/to/your-project" --mode code
```

This path uses local file-backed search. SQLite can be added separately, so the
first build does not need a SQLite search database.

## Search by intention

Find a word or symbol:

```sh
node bin/pairofcleats.js search --repo "path/to/your-project" --mode code --backend memory --top 5 -- "cache"
```

Narrow to a directory:

```sh
node bin/pairofcleats.js search --repo "path/to/your-project" --mode code --backend memory --path src -- "cache"
```

Get structured output for a tool:

```sh
node bin/pairofcleats.js search --repo "path/to/your-project" --mode code --backend memory --json --compact -- "cache"
```

Choose terms from your own project. Sparse search treats adjacent unquoted terms
as a conjunction, so a long natural-language question may be restrictive. Quoted
phrases and explicit Boolean operators help you say what must match. Filters stay
useful when you know a path, language, import or symbol property.

Add `--explain` when you want ranking details. See the
[search guide](search.md) for query behavior, filters and output controls.

## Add documentation search

```sh
node bin/pairofcleats.js index build --repo "path/to/your-project" --mode prose --threads 1 --no-sqlite
node bin/pairofcleats.js search --repo "path/to/your-project" --mode prose --backend memory --top 5 -- "installation"
```

Build each mode before querying it. An empty result can mean no matching indexed
content, an overly restrictive query, an active filter or a missing mode; use
`index validate` and simpler terms to distinguish those cases.

## Add optional capabilities when useful

[Guided setup](setup.md) can download dictionaries/models, detect/install language
tools and build indexes or SQLite. Review the choices rather than accepting a
larger setup merely to run the first search. Model downloads are a separate choice
from sparse indexing.

Use [language acceptance](language-toolchain-acceptance.md) to check the scope of
a syntax parser, types or navigation route before treating it as complete.
[Backend choices](external-backends.md) and [embedding setup](embeddings.md)
explain richer retrieval paths. None is required by the code-search recipe above.

Once you have useful results, [code maps](code-maps.md), context packs, impact and
test-suggestion commands can help you explore related code. Run
`node bin/pairofcleats.js help` for the current command surface.
