function alpha() {
  return 1;
}

function beta() {
  return alpha();
}

class Widget {
  constructor() {
    this.value = beta();
  }

  method() {
    return alpha();
  }
}

const widget = new Widget();
widget.method();
