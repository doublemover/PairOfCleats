from pkg import api
from .subpackage import helper


class Widget:
  def run(self):
    return helper(api)


def helper_task(value):
  return api.call(value)
