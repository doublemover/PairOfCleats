{ pkgs ? import <nixpkgs> {} }:
let
  widget = pkgs.hello;
in
  widget
