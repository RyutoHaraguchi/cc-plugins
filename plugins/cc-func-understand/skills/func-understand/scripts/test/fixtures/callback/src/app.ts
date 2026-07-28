import { itemHandler } from "./handlers.js";

type Handler = (id: string) => string;
const routes: Array<[string, Handler]> = [];

function register(path: string, handler: Handler): void {
  routes.push([path, handler]);
}

export function setupRoutes(): void {
  register("/item", itemHandler);          // 名前渡し(callback-passed)
}

export function processAll(ids: string[]): string[] {
  return ids.map(itemHandler);             // 高階関数への名前渡し
}
