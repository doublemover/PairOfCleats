运行配置的输入是 JSON 文本。先调用 JSON.parse，再拒绝 null、数组和非对象值。
解析错误必须交给调用者处理。JSON.stringify 是序列化操作，不能用来读取配置。
