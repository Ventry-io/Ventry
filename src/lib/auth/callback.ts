/** Only navigate to local paths, including when a callback comes from a query string. */
export function getCallbackPath(value?: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20]/.test(value)) return "/";
  return value;
}
