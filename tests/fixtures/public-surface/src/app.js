export function greet(name) {
  const target = name || 'world';
  return `Hello, ${target}!`;
}

export function add(a, b) {
  return Number(a) + Number(b);
}
