export function handle(req) {
  const cmd = req.body;
  return build(cmd);
}

export function build(x) {
  return run(x);
}

export function run(cmd) {
  return eval(cmd);
}
