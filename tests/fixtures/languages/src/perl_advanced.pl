package Demo::Tools;
use strict;
use warnings;
use JSON::PP;

# Greets a caller.
sub greet {
  my ($name) = @_;
  return "Hello, $name";
}

sub encode_payload {
  my ($data) = @_;
  return JSON::PP::encode_json($data);
}

1;
