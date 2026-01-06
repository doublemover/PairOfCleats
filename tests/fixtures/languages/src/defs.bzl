def widget_rule(name):
  native.genrule(
    name = name,
    outs = ["widget.txt"],
    cmd = "echo hello > $@",
  )
