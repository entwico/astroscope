import type { BootContext } from '@astroscope/node';
import { getBootContext } from '@astroscope/node/boot';
import { mountNativeHandler } from '@astroscope/node/native';
import { disposeSingleton, initSingleton } from './server/singleton';

export function onStartup(context: BootContext): void {
  initSingleton();

  const stamped = getBootContext();
  const ctx =
    stamped && stamped.dev && stamped.host === context.host && stamped.port === context.port ? 'ok' : 'mismatch';

  console.log(`[dev-e2e] startup ctx=${ctx}`);

  mountNativeHandler({ prefix: '/native', name: 'native-echo' }, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ native: true, url: req.url }));
  });
}

export function onShutdown(): void {
  disposeSingleton();
}
