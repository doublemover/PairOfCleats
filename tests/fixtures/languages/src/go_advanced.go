package demo

import (
  "fmt"
  "strings"
)

// Widget holds a name.
type Widget struct {
  Name string
}

// Render formats a label.
func (w *Widget) Render(label string) string {
  return fmt.Sprintf("%s:%s", label, w.Name)
}

// MakeWidget builds a widget.
func MakeWidget(name string) *Widget {
  return &Widget{Name: strings.TrimSpace(name)}
}

type Greeter interface {
  Greet(name string) string
}
