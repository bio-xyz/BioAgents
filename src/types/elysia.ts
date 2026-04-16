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
 * NOTE: `body` is typed as `unknown` so this interface remains structurally
 * compatible with Elysia's inline handler context (where body is also
 * `unknown` until validated). Handlers narrow `body` locally — typically by
 * casting to the TBody shape once required fields are checked. TBody is
 * retained as a documentation hint for the expected payload shape.
 *
 * Similarly, `query` values are typed as `string | undefined` (Elysia's
 * runtime shape) and `set.status` accepts number or string (Elysia's
 * `StatusMap` keys) to match the inline context's structural contract.
 */
export interface ElysiaRouteContext<
  TParams extends Record<string, string> = Record<string, string>,
  TBody = unknown,
> {
  params: TParams;
  body: TBody;
  query: Record<string, string | undefined>;
  set: {
    status?: number | string;
    headers: Record<string, string | number>;
  };
  request: Request;
}
