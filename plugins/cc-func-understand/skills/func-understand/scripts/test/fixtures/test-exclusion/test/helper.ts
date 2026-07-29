import { createWidget } from '../src/core';
import { runFactory } from '../src/runner';

export function helperCall() {
  return createWidget('from-helper');
}

export function passesFactory() {
  return runFactory(createWidget);
}
