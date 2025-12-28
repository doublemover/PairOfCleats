use std::fmt;

/// Greeter for Rust samples.
#[derive(Debug)]
pub struct RustGreeter;

impl RustGreeter {
  /// Compose greeting.
  pub fn greet(name: &str) -> String {
    format!("hello {}", name)
  }
}

pub fn rust_greet(name: &str) -> String {
  format!("hello {}", name)
}
