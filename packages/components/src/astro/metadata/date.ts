// unparseable input returns undefined so the caller skips the value
export function toIsoDate(value: Date | string): string | undefined {
  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
