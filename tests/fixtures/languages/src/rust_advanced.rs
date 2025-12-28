pub struct Widget {
    pub value: i32,
}

#[macro_export]
macro_rules! make_widget {
    ($value:expr) => {
        Widget { value: $value }
    };
}

pub trait Render {
    fn render(&self) -> String;
}

impl Render for Widget {
    fn render(&self) -> String {
        format!("Widget {}", self.value)
    }
}

impl Widget {
    pub fn new(value: i32) -> Widget {
        Widget { value }
    }
}

pub fn rust_helper(a: i32) -> i32 {
    a + 1
}
