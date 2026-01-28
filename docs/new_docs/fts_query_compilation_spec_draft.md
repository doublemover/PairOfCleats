# Draft Spec: FTS Query Compilation (AST → SQLite FTS5 `MATCH`)

This spec defines how PairOfCleats compiles its internal **query AST** into a deterministic, injection-safe SQLite FTS5 `MATCH` string.

Primary goal:
- downstream refactors must not silently change query semantics.

---

## 1) Scope

This spec applies to the **FTS provider** (SQLite FTS5) used in retrieval when searching text/doc fields.

It covers:
- AST node types and their meaning,
- operator precedence,
- token/phrase normalization,
- escaping rules,
- compilation rules to a `MATCH` string,
- and error handling / “empty query” behavior.

It does **not** cover:
- ANN query compilation,
- BM25 weighting configuration,
- ranking post-processing outside SQLite.

---

## 2) Inputs

### 2.1 Query AST (normative)

The AST is the output of boolean parsing (currently produced by `src/retrieval/query.js:parseBooleanQuery(...)`).

Node shapes:

```ts
type AstNode =
  | { type: 'term'; value: string }
  | { type: 'phrase'; value: string }
  | { type: 'and'; left: AstNode; right: AstNode }
  | { type: 'or'; left: AstNode; right: AstNode }
  | { type: 'not'; child: AstNode };
```

### 2.2 Normalization
Before compilation:
- each `term.value` and `phrase.value` MUST be normalized using the same pipeline as query parsing:
  - Unicode NFKD normalization
  - trimming
  - whitespace collapsing (for phrases)
- empty terms/phrases MUST be dropped (or cause the node to compile to an empty expression)

---

## 3) Operator precedence and parentheses

FTS5 operator precedence (and our required behavior):
1. `NOT` (highest)
2. `AND`
3. `OR` (lowest)

Compilation MUST preserve the AST meaning even if SQLite precedence differs.
Therefore:
- Always use parentheses around binary expressions unless the expression is a single leaf.

---

## 4) Escaping and injection safety (critical)

### 4.1 Prohibited raw embedding
User-provided strings MUST NOT be interpolated directly into the `MATCH` string without escaping.

### 4.2 Token escaping rules
To compile a safe token:
1. Tokenize the string into “safe” tokens using the same tokenization as `tokenizeQueryTerms` (or a documented subset).
2. For each token, escape double quotes by doubling them: `"` → `""`.
3. Emit as a quoted token: `"token"`.

### 4.3 Phrase escaping rules
To compile a safe phrase:
1. Tokenize phrase value into tokens.
2. Join tokens with single spaces.
3. Escape any double quotes within tokens by doubling them.
4. Emit as a quoted phrase: `"token1 token2 token3"`.

### 4.4 Empty after tokenization
If a term or phrase produces zero tokens:
- it compiles to an empty expression.

---

## 5) Compilation rules (AST → MATCH)

Define `compile(node) -> string`:

### 5.1 Leaf nodes

#### Term
- Input: `{ type:'term', value }`
- Output:
  - if tokenization yields `t1..tn`:
    - if `n==1`: `"t1"`
    - if `n>1`: compile as AND of tokens: `("t1" AND "t2" AND …)`

#### Phrase
- Input: `{ type:'phrase', value }`
- Output:
  - if tokenization yields `t1..tn` and `n>=1`: `"t1 t2 … tn"`
  - else empty

### 5.2 Unary NOT
- Input: `{ type:'not', child }`
- Output:
  - if child compiles empty → empty
  - else: `(NOT <childExpr>)`

### 5.3 Binary AND / OR
- AND:
  - if either side empty, result is the other side (identity)
  - else: `(<leftExpr> AND <rightExpr>)`

- OR:
  - if either side empty, result is the other side (identity)
  - else: `(<leftExpr> OR <rightExpr>)`

**Note:** This identity behavior means “empty tokens” do not accidentally make the whole query invalid.

---

## 6) Output post-processing

After compilation:
- Strip outermost redundant parentheses (optional but keep deterministic).
- Collapse multiple spaces to single spaces.
- If final output is empty:
  - FTS provider must be considered “not applicable” for this query and should return zero candidates (or skip provider).

---

## 7) Examples (normative)

### Example A
Input: `foo bar`
AST: `and(term(foo), term(bar))`
MATCH:
```text
("foo" AND "bar")
```

### Example B
Input: `"foo bar" baz`
AST: `and(phrase("foo bar"), term(baz))`
MATCH:
```text
("foo bar" AND "baz")
```

### Example C
Input: `foo OR bar`
MATCH:
```text
("foo" OR "bar")
```

### Example D
Input: `foo -bar` (parsed as NOT)
MATCH:
```text
("foo" AND (NOT "bar"))
```

### Example E (tokenization expansion)
Input term: `foo-bar` → tokens `foo`, `bar`
MATCH:
```text
("foo" AND "bar")
```

---

## 8) Compatibility notes

### 8.1 AND/OR keyword collisions
If a user wants to search for the literal word `and`, the parser requires quoting.
This is acceptable; document it.

### 8.2 Column scoping (future)
This spec does not define `column:term` scoping.
If added later, it MUST be introduced under a schema/behavior version bump.

---

## 9) Required tests

### Golden compilation tests
Add `tests/fts/compile-match.test.js` containing:
- a table of `(inputQuery, expectedAstShape, expectedMatchString)`
- including edge cases:
  - empty query
  - quote escaping
  - nested parentheses
  - long phrases
  - pathological punctuation

### SQLite execution tests (optional but useful)
- Build a tiny FTS fixture DB
- Ensure the compiled `MATCH` string executes without syntax errors and returns expected rows

---

## 10) Open questions

1. Should we support prefix searches (`foo*`) and how do we escape them safely?
2. Should we support NEAR queries? (Probably later.)
3. Which tokenizer is authoritative for FTS compilation: our own `tokenizeQueryTerms` or SQLite’s tokenizer?
4. Do we want to restrict compilation to a “safe subset” even if SQLite supports more, to ensure stable semantics?

