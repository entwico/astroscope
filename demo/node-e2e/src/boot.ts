import type { BootContext } from '@astroscope/node';
import { getBootContext } from '@astroscope/node/boot';
import { registerHealthCheck } from '@astroscope/node/health';
import { mountNativeHandler } from '@astroscope/node/native';
import { disposeSingleton, getSingleton, initSingleton } from './server/singleton';

export function onStartup(context: BootContext): void {
  initSingleton();

  registerHealthCheck({
    name: 'singleton',
    check: () => {
      getSingleton();
    },
  });

  mountNativeHandler({ prefix: '/native', name: 'native-echo' }, (req, res) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      res.setHeader('set-cookie', ['native_a=1', 'native_b=2']);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          native: true,
          method: req.method,
          url: req.url,
          remoteAddress: req.socket.remoteAddress,
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
  });

  mountNativeHandler({ prefix: '/native/failing' }, () => {
    throw new Error('native mount boom');
  });

  const stamped = getBootContext();
  const ctx =
    stamped && stamped.dev === context.dev && stamped.host === context.host && stamped.port === context.port
      ? 'ok'
      : 'mismatch';

  console.log(`[e2e] startup dev=${context.dev} host=${context.host} port=${context.port} ctx=${ctx}`);
}

export function onShutdown(): void {
  disposeSingleton();

  console.log('[e2e] shutdown');
}
