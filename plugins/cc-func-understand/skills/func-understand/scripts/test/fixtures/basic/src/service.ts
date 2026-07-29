import { formatName } from "./util.js";
import { shorten } from "fake-lib";

export function getUser(id: string): string {
  return formatName(id) + shorten("/tmp/x");
}
