import { formatName } from "./util.js";
import { basename } from "node:path";

export function getUser(id: string): string {
  return formatName(id) + basename("/tmp/x");
}
