import { afterEach, expect, jest, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describeIfPdf } from "../../../utils/__testHelpers__/integrationEnv";
import logger from "../../../utils/logger";
import { extractPDFText } from "../description";

const messageOf = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "";
};

describeIfPdf("[integration] extractPDFText corrupted-PDF path", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns concrete error text, not 'unknown', when PDF is corrupted", async () => {
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => undefined);

    const fixturePath = join(process.cwd(), "test", "fixtures", "corrupted.pdf");
    const buffer = await readFile(fixturePath);

    const result = await extractPDFText(buffer, "corrupted.pdf");

    // Invariant: the catch path must surface the underlying error message.
    // A bare `{...error}` spread produces `message: undefined` (Error props
    // are non-enumerable), which then degrades to the literal string "unknown"
    // in the user-visible return value — that is the regression guarded here.
    expect(result.startsWith("[PDF file: corrupted.pdf - extraction error:")).toBe(true);
    expect(result.includes("- extraction error: unknown]")).toBe(false);

    // logger.error must fire exactly once with a truthy `err.message`. The
    // empty-spread regression would produce `err = {}` → zero-length message.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const errorCall = errorSpy.mock.calls.find(([, msg]) => msg === "pdf_extraction_failed");
    expect(errorCall).toBeDefined();
    const ctx = errorCall![0] as { err: unknown; filename: string };
    expect(ctx.filename).toBe("corrupted.pdf");
    expect(messageOf(ctx.err).length).toBeGreaterThan(0);
  });
});
