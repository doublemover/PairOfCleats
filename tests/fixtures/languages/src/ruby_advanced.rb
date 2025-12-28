# Widget demo
require 'json'

module Demo
  class Widget
    # Create a widget
    def initialize(name)
      @name = name
    end

    def render
      @name.upcase
    end

    def self.build(name)
      new(name)
    end
  end
end
