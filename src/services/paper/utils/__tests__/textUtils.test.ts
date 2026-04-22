import { describe, expect, test } from "bun:test";
import { sanitizeFilename, truncateText } from "../textUtils";

describe("sanitizeFilename", () => {
  test("passes through safe filenames", () => {
    expect(sanitizeFilename("report.pdf")).toBe("report.pdf");
    expect(sanitizeFilename("my-file_v2.txt")).toBe("my-file_v2.txt");
  });

  test("replaces special characters with underscores", () => {
    expect(sanitizeFilename("my file (1).pdf")).toBe("my_file_1_.pdf");
  });

  test("collapses multiple underscores", () => {
    expect(sanitizeFilename("a   b")).toBe("a_b");
    expect(sanitizeFilename("a!!!b")).toBe("a_b");
  });
});

describe("truncateText", () => {
  test("returns text unchanged if within limit", () => {
    expect(truncateText("short", 100)).toBe("short");
  });

  test("truncates with ellipsis", () => {
    expect(truncateText("hello world", 8)).toBe("hello...");
  });

  test("returns falsy input as-is", () => {
    expect(truncateText("", 10)).toBe("");
    // @ts-expect-error testing null input
    expect(truncateText(null, 10)).toBeNull();
  });

  test("handles exact boundary", () => {
    expect(truncateText("12345", 5)).toBe("12345");
    expect(truncateText("123456", 5)).toBe("12...");
  });
});
