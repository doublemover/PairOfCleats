#include <node_api.h>
#include <io.h>

/* Fault injection only: libuv deliberately ignores fs.close(0..2) on Windows.
 * This closes this process's original CRT stdout, never an arbitrary handle. */
static napi_value close_stdout(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value argument;
  napi_get_cb_info(env, info, &count, &argument, NULL, NULL);
  if (count != 0) {
    napi_throw_type_error(env, "ERR_STDOUT_CLOSE_ARGUMENT", "No descriptor argument is accepted.");
    return NULL;
  }
  if (_close(1) != 0) {
    napi_throw_error(env, "ERR_STDOUT_CLOSE", "Original CRT stdout did not close.");
    return NULL;
  }
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value close;
  napi_create_function(env, "closeOriginalStdout", NAPI_AUTO_LENGTH, close_stdout, NULL, &close);
  napi_set_named_property(env, exports, "closeOriginalStdout", close);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
