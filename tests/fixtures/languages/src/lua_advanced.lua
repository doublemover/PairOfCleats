-- Widget module
local Widget = {}
Widget.__index = Widget

function Widget:new(name)
  local obj = setmetatable({ name = name }, self)
  return obj
end

function Widget:render()
  return self.name
end

local function make_widget(name)
  return Widget:new(name)
end

return { Widget = Widget, make_widget = make_widget }
