def widget_lib(name, srcs):
  native.cc_library(
    name = name,
    srcs = srcs,
  )
