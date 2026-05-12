/**
 * Env-gated describe helpers for integration tests.
 *
 * Integration suites wrap `describeIfSupabase` or `describeIfPdf` around their
 * `describe("[integration] ...", ...)` block. When the required env is not
 * present the suite reports as skipped with bun:test's normal skip output.
 *
 * The `[integration]` prefix in describe titles lets CI filter with:
 *   bun test --test-name-pattern '\[integration\]'
 * while the default `bun test` in the unit-test job picks them up too (they
 * simply skip when services aren't running).
 */

import { describe } from "bun:test";

// Guard against env vars that exist but carry meaningless values — without
// this, `"undefined"` or an empty string would be truthy and the suite would
// run then fail inside the Supabase client with an opaque connection error.
const present = (v: string | undefined): boolean =>
  !!v && v.trim() !== "" && v !== "undefined" && v !== "null";

export const hasSupabaseEnv =
  present(process.env.RUN_SUPABASE_INTEGRATION) &&
  present(process.env.SUPABASE_URL) &&
  present(process.env.SUPABASE_SERVICE_KEY);

export const hasPdfEnv = present(process.env.RUN_PDF_INTEGRATION);

export const describeIfSupabase = hasSupabaseEnv ? describe : describe.skip;
export const describeIfPdf = hasPdfEnv ? describe : describe.skip;
