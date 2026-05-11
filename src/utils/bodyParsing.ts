/**
 * Shared helpers for narrowing unknown request bodies (JSON or multipart/form-data)
 * into typed field reads without `any` casts. Used by the chat and deep-research
 * routes.
 */

export function isBodyRecord(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function extractFiles(value: unknown): File[] {
  if (!value) return [];
  if (value instanceof File) return [value];
  if (Array.isArray(value)) {
    return value.filter((f): f is File => f instanceof File);
  }
  return [];
}
