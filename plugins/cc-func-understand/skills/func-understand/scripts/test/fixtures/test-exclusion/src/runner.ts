export function runFactory(factory: (name: string) => { name: string }) {
  return factory('run');
}
