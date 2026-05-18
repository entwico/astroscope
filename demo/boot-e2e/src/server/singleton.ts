let ready = false;

export function initSingleton(): void {
  ready = true;
}

export function disposeSingleton(): void {
  ready = false;
}

export function readSingleton(): string {
  if (!ready) {
    throw new Error('singleton used before init or after dispose');
  }

  return 'ok';
}
