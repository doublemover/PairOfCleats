export function source(req) {
  const value = req.body;
  return value;
}

export function sink(value) {
  return eval(value);
}

export function run(req) {
  const value = source(req);
  return sink(value);
}
