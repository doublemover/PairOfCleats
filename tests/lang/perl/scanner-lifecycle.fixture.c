#include <assert.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static long allocations = 0;
static void *tracked_malloc(size_t n) { void *p = malloc(n); if (p) allocations++; return p; }
static void *tracked_calloc(size_t n, size_t s) { void *p = calloc(n, s); if (p) allocations++; return p; }
static void *tracked_realloc(void *p, size_t n) {
  bool was_null = p == NULL;
  void *next = realloc(p, n);
  if (was_null && next) allocations++;
  return next;
}
static void tracked_free(void *p) { if (p) allocations--; free(p); }
#define malloc tracked_malloc
#define calloc tracked_calloc
#define realloc tracked_realloc
#define free tracked_free
#ifndef SCANNER_FILE
#define SCANNER_FILE "perl-scanner-under-test.c"
#endif
#include SCANNER_FILE
#undef malloc
#undef calloc
#undef realloc
#undef free

typedef struct { TSLexer lexer; const char *text; size_t position, marked; } Input;
static void move(TSLexer *lexer, bool skip) {
  (void)skip;
  Input *input = (Input *)lexer;
  if (input->text[input->position]) input->position++;
  lexer->lookahead = (unsigned char)input->text[input->position];
}
static void mark(TSLexer *lexer) { Input *input = (Input *)lexer; input->marked = input->position; }
static bool eof(const TSLexer *lexer) { return lexer->lookahead == 0; }
static Input input(const char *text) {
  return (Input){ .lexer = { .lookahead = (unsigned char)text[0], .advance = move,
    .mark_end = mark, .eof = eof }, .text = text };
}
static void enqueue(Scanner *scanner, const char *text) {
  Input value = input(text);
  assert(advance_word(scanner, &value.lexer));
}
int main(void) {
  Scanner *scanner = tree_sitter_perl_external_scanner_create();
  assert(scanner);
  enqueue(scanner, "~'FIRST'");
  enqueue(scanner, "'SECOND'");
  long baseline = allocations;
  for (int i = 0; i < 128; i++) {
    Input content = input("ordinary content\n");
    assert(exit_if_heredoc_end_delimiter(scanner, &content.lexer));
    assert(content.lexer.result_symbol == HEREDOC_CONTENT);
    assert(allocations == baseline);
  }
  Input failed = input(" unquoted");
  assert(!advance_word(scanner, &failed.lexer));
  assert(allocations == baseline);
  assert(scanner->heredoc.heredoc_allows_indent->len == 2);
  scanner->start_delimiter_char = '{'; scanner->end_delimiter_char = '}';
  scanner->is_separator_delimiter_parsed = true; scanner->is_delimiter_enclosing = true;
  scanner->heredoc.started_heredoc_body = true;
  char bytes[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  unsigned length = serialize(scanner, bytes);
  assert(length > 0 && length <= sizeof(bytes));
  Scanner *restored = tree_sitter_perl_external_scanner_create();
  deserialize(restored, bytes, length);
  assert(restored->start_delimiter_char == '{' && restored->end_delimiter_char == '}');
  assert(restored->is_separator_delimiter_parsed && restored->is_delimiter_enclosing);
  assert(restored->heredoc.started_heredoc && restored->heredoc.started_heredoc_body);
  assert(restored->heredoc.heredoc_identifier_queue->len == 2);
  assert(!strcmp(front(restored->heredoc.heredoc_identifier_queue), "FIRST"));
  assert(frontBoolQueue(restored->heredoc.heredoc_allows_indent));
  assert(!frontBoolQueue(restored->heredoc.heredoc_allows_interpolation));
  char repeated[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  assert(serialize(restored, repeated) == length && !memcmp(bytes, repeated, length));
  bool valid[AUTOMATIC_SEMICOLON + 1] = {0}; valid[HEREDOC_CONTENT] = true;
  for (int i = 0; i < 2; i++) {
    Input literal = input(i ? "\\FIRST\n" : "$FIRST\n");
    assert(scan(restored, &literal.lexer, valid));
    assert(literal.lexer.result_symbol == HEREDOC_CONTENT);
    assert(restored->heredoc.heredoc_identifier_queue->len == 2);
  }
  Input trailing = input("FIRST trailing\n");
  assert(exit_if_heredoc_end_delimiter(restored, &trailing.lexer));
  assert(trailing.lexer.result_symbol == HEREDOC_CONTENT);
  Input end = input("FIRST\n");
  assert(exit_if_heredoc_end_delimiter(restored, &end.lexer));
  assert(end.lexer.result_symbol == HEREDOC_END_IDENTIFIER);
  assert(restored->heredoc.heredoc_identifier_queue->len == 1);
  assert(restored->heredoc.heredoc_allows_indent->len == 1);
  assert(!frontBoolQueue(restored->heredoc.heredoc_allows_indent));
  for (unsigned i = 0; i < length; i++) {
    deserialize(restored, bytes, i);
    assert(restored->heredoc.heredoc_identifier_queue->len == 0);
  }
  bytes[0] = 127;
  deserialize(restored, bytes, length);
  assert(restored->heredoc.heredoc_identifier_queue->len == 0);
  reset(restored);
  char oversized[TREE_SITTER_SERIALIZATION_BUFFER_SIZE + 2];
  memset(oversized, 'A', sizeof(oversized) - 1); oversized[sizeof(oversized) - 1] = 0;
  Input large = input(oversized);
  assert(!advance_word(restored, &large.lexer));
  assert(restored->heredoc.heredoc_identifier_queue->len == 0);
  assert(restored->heredoc.heredoc_allows_indent->len == 0);
  tree_sitter_perl_external_scanner_destroy(scanner);
  tree_sitter_perl_external_scanner_destroy(restored);
  assert(allocations == 0);
  puts("Perl scanner ownership, state restoration, literal delimiters and bounds passed.");
  return 0;
}
