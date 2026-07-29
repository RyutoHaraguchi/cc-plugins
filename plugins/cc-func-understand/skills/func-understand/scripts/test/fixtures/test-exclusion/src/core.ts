import { logCreation } from './log';

export function createWidget(name: string) {
  logCreation(name);
  return { name };
}

export function useWidget() {
  return createWidget('main');
}
