import type { AuthContext } from "./auth";

/**
 * Global augmentation so `request.auth` is typed everywhere in the app.
 * The `authResolver` middleware attaches this property to the Fetch API
 * Request used by Bun/Elysia.
 */
declare global {
  interface Request {
    auth?: AuthContext;
  }
}

/**
 * Typed Elysia route context for standalone handler functions.
 *
 * Elysia infers handler context when handlers are inline lambdas, but when
 * extracted to named functions the inference is lost. This interface captures
 * the parts every handler actually uses (params, body, set, request.auth).
 *
 * `body` is `unknown` so this interface stays structurally compatible with
 * Elysia's inline context; handlers narrow locally via `isBodyRecord` and
 * friends. `query` values are `string | undefined` (Elysia's runtime shape)
 * and `set.status` accepts number or string (Elysia's `StatusMap` keys).
 */
export interface ElysiaRouteContext<
  TParams extends Record<string, string> = Record<string, string>,
> {
  params: TParams;
  body: unknown;
  query: Record<string, string | undefined>;
  set: {
    status?: number | string;
    headers: Record<string, string | number>;
  };
  request: Request;
}
