export const quotedToml = ['"in\\u0063lude" = "escaped.toml"', '"literal.dot".includes = ["dotted.toml"]',
  '"" = "empty key"', 'count = 9223372036854775807', 'date = 1979-05-27T07:32:00Z',
  '["tool.poc"."😀"]', "'include' = 'unicode.toml'", '[dependencies."quoted.crate"]',
  'path = "../quoted"', 'version = "1.0"'].join('\n');
