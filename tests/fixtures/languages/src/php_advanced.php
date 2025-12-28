<?php
namespace Demo;

use RuntimeException;

/** Widget interface */
interface Renderable {
  public function render(): string;
}

/** Widget implementation */
class Widget implements Renderable {
  private string $name;

  public function __construct(string $name) {
    $this->name = $name;
  }

  public function render(): string {
    return $this->name;
  }
}

function make_widget(string $name): Widget {
  return new Widget($name);
}
