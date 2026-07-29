export function pingA(n: number): number {
  return n <= 0 ? 0 : pingB(n - 1);
}
export function pingB(n: number): number {
  return n <= 0 ? 1 : pingA(n - 1);
}
