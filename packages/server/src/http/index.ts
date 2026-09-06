export {
  createHttpCore,
  type HttpCore,
  type HttpCoreDeps,
  type RequestOptions,
} from "./client.js";
export { HOST_CONFIG } from "./config.js";
export type { HostId, HttpResult, RequestMeta } from "./types.js";

import { createHttpCore, type HttpCore } from "./client.js";

let defaultCore: HttpCore | undefined;

/** Lazily-created production HTTP core — the only construction site outside tests. */
export function getHttpCore(): HttpCore {
  defaultCore ??= createHttpCore();
  return defaultCore;
}
