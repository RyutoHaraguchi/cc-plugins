export class Formatter {
  format(): string {
    return "formatted";
  }
}

export function core(): string {
  return new Formatter().format();
}

export const arrowCaller = (): string => {
  return core();
};

core();
