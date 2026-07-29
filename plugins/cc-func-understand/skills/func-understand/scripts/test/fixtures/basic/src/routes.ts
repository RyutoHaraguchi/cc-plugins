import { getUser } from "./service.js";

export function handleGetUser(id: string): string {
  return getUser(id);
}
