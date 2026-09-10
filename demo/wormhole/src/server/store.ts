// in-memory counter storage — resets on server restart
let count = 0;

export function getCount(): number {
  return count;
}

export function setCount(value: number): number {
  count = value;

  return count;
}

const loads: Record<string, number> = {};

export function recordLoad(name: string): void {
  loads[name] = (loads[name] ?? 0) + 1;
}

export function getLoads(): Record<string, number> {
  return { ...loads };
}
