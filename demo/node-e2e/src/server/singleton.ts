let value: string | undefined;

export function initSingleton(): void {
  value = 'initialized';
}

export function disposeSingleton(): void {
  value = undefined;
}

export function getSingleton(): string {
  if (!value) throw new Error('singleton not initialized');

  return value;
}
