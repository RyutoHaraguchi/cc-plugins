export type Fn = (x: string) => string;
const registry = new Map<string, Fn>();

export function register(name: string, fn: Fn): void {
  registry.set(name, fn);
}
