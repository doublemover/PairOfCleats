/** Top-level docs */
export function top(x) {
  return x + 1;
}

const cb = (value) => value * 2;

export const exported = () => {
  return cb(2);
};

class Foo {
  /** Method docs */
  method(a) {
    return a;
  }

  make() {
    return (z) => z;
  }
}

function outer() {
  const inner = (z) => z;
  return inner(1);
}
