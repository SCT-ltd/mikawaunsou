/**
 * Collapse an Express route param to a single string.
 *
 * Express 5 types `req.params[key]` as `string | string[]`, but route params
 * are always single values at runtime. Use this before parsing so call sites
 * stay type-safe without scattering casts.
 */
export function paramStr(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
