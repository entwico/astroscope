import { afterEach, expect, test, vi } from 'vitest';

vi.mock('virtual:@astroscope/cap/config', () => ({ path: '/_cap/' }));
vi.mock('@cap.js/wasm/browser/cap_wasm_bg.wasm?url', () => ({ default: '/wasm' }));
vi.mock('@cap.js/wasm/browser/hashwx.wasm?url', () => ({ default: '/hashwx' }));
vi.mock('pako/browser/inflate?url', () => ({ default: '/pako' }));
vi.mock('cap-widget', () => ({}));

const { registerCapWidget } = await import('./index');

afterEach(() => {
  vi.unstubAllGlobals();
});

test('a failed client load is retried by the next call, a successful one is kept', async () => {
  const whenDefined = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error('chunk load failed'))
    .mockResolvedValue(undefined);

  vi.stubGlobal('window', {});
  vi.stubGlobal('document', { addEventListener: vi.fn() });
  vi.stubGlobal('customElements', { whenDefined });

  await expect(registerCapWidget()).rejects.toThrow('chunk load failed');
  await expect(registerCapWidget()).resolves.toBeUndefined();
  await expect(registerCapWidget()).resolves.toBeUndefined();

  expect(whenDefined).toHaveBeenCalledTimes(2);
});
