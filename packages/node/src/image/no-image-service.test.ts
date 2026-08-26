import { describe, expect, test } from 'vitest';
import { GET } from './endpoint-disabled';
import service from './no-image-service';

const imageConfig = {} as never;

describe('no-image-service', () => {
  test('throws with an explanation on any astro:assets use', () => {
    const options = { src: '/_astro/photo.abc123.png', width: 400 } as never;

    expect(() => service.validateOptions!(options, imageConfig)).toThrow('image processing is disabled');
    expect(() => service.getURL(options, imageConfig)).toThrow('image processing is disabled');
    expect(() => service.getSrcSet!(options, imageConfig)).toThrow('image processing is disabled');
    expect(() => service.getHTMLAttributes!(options, imageConfig)).toThrow('image processing is disabled');
    expect(() => service.transform(new Uint8Array(), { src: '/x.png' }, imageConfig)).toThrow(
      'image processing is disabled',
    );
  });

  test('parseURL rejects everything, should the standard endpoint ever run it', () => {
    expect(service.parseURL(new URL('https://app.example/_image?href=%2Fx.png&w=99999999999'), imageConfig)).toBe(
      undefined,
    );
  });

  test('the replaced endpoint answers 404', async () => {
    const response = await GET({} as never);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });
});
