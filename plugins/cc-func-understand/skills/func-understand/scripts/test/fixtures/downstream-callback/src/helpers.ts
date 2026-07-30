export function helper(x: string): string {
  return normalize(x);            // helper の下流継続確認用(direct-call)
}

export function normalize(x: string): string {
  return x.trim();
}

export const utils = {
  fmt(x: string): string {
    return `[${x}]`;
  },
};
