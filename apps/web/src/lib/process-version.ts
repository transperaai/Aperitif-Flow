/** The version a `?version=` names (a whole number from 1, up to nine digits), or null for live. */
export function parseVersion(value: string | string[] | undefined): number | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && /^[1-9]\d{0,8}$/.test(v) ? Number(v) : null;
}
