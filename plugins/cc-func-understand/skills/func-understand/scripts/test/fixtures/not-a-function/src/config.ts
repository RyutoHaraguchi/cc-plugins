export const API_CONFIG = { baseUrl: "https://example.com" };
export const MAX_RETRIES = 3;
export const config = { retries: 3 };
export let counter;
export class WidgetStore {
  load(): string {
    return "loaded";
  }
}
export enum Color {
  Red,
  Green,
}
export interface Widget {
  id: string;
}
export type WidgetId = string;

export function loadConfig(): typeof API_CONFIG {
  return API_CONFIG;
}

export const applyConfig = (): number => {
  loadConfig();
  return MAX_RETRIES;
};
