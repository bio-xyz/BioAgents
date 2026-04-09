import { describe, expect, test } from "bun:test";
import { doiToCitekey, isValidDOI, normalizeDOI } from "../doi";

describe("normalizeDOI", () => {
  test("lowercases and trims", () => {
    expect(normalizeDOI("  10.1234/ABC  ")).toBe("10.1234/abc");
  });

  test("strips trailing punctuation", () => {
    expect(normalizeDOI("10.1234/abc.")).toBe("10.1234/abc");
    expect(normalizeDOI("10.1234/abc;")).toBe("10.1234/abc");
    expect(normalizeDOI("10.1234/abc,:")).toBe("10.1234/abc");
  });

  test("unescapes LaTeX characters", () => {
    expect(normalizeDOI("10.1234/a\\_b\\&c\\%d")).toBe("10.1234/a_b&c%d");
  });
});

describe("doiToCitekey", () => {
  test("produces doi_ prefix with normalized slug", () => {
    expect(doiToCitekey("10.1038/nature12345")).toBe("doi_10_1038_nature12345");
  });

  test("replaces non-alphanumeric chars with underscores", () => {
    expect(doiToCitekey("10.1234/s41586-023-06600-9")).toBe("doi_10_1234_s41586_023_06600_9");
  });

  test("is case-insensitive", () => {
    expect(doiToCitekey("10.1234/ABC")).toBe(doiToCitekey("10.1234/abc"));
  });
});

describe("isValidDOI", () => {
  test("accepts valid DOIs", () => {
    expect(isValidDOI("10.1038/nature12345")).toBe(true);
    expect(isValidDOI("10.1234/s41586-023-06600-9")).toBe(true);
    expect(isValidDOI("10.11111/test.123")).toBe(true);
  });

  test("rejects invalid DOIs", () => {
    expect(isValidDOI("not-a-doi")).toBe(false);
    expect(isValidDOI("10.12/short")).toBe(false); // prefix too short
    expect(isValidDOI("")).toBe(false);
    expect(isValidDOI("10.1234/ space")).toBe(false);
  });
});
