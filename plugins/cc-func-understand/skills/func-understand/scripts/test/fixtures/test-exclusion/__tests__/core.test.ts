import { createWidget, useWidget } from '../src/core';
import { helperCall } from '../test/helper';

export function callInTest() {
  helperCall();
  return createWidget('from-test');
}

export function anotherTestCaller() {
  return useWidget();
}
