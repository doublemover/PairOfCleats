pub struct Widget {
    pub value: i32,
}

pub trait Render {
    fn render(&self) -> String;
}

impl Render for Widget {
    fn render(&self) -> String {
        format!("Widget {}", self.value)
    }
}

pub fn rust_helper(a: i32) -> i32 {
    a + 1
}
