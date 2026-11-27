import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export type DemoServer = {
  origin: string;
  stop: () => Promise<void>;
};

const demoRoot = path.resolve(import.meta.dirname, '../demo');

/**
 * Starts a demo's built prod server. Health and metrics get the two ports after `port`, so every
 * suite takes a block of three.
 */
export async function startDemo(demo: string, port: number, env: Record<string, string> = {}): Promise<DemoServer> {
  const cwd = path.join(demoRoot, demo);

  if (!existsSync(path.join(cwd, 'dist/server/entry.mjs'))) {
    throw new Error(`demo/${demo} is not built — run \`pnpm build\` first`);
  }

  const server = spawn('node', ['./dist/server/entry.mjs'], {
    cwd,
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      HEALTH_PORT: String(port + 1),
      OTEL_EXPORTER_PROMETHEUS_PORT: String(port + 2),
    },
    stdio: 'pipe',
  });

  const origin = `http://localhost:${port}`;

  await waitForServer(server, origin);

  return {
    origin,
    stop: () =>
      new Promise((resolve) => {
        if (server.exitCode !== null) {
          resolve();

          return;
        }

        server.once('exit', () => resolve());
        server.kill();
      }),
  };
}

// the child's output is drained from the start (an unread pipe stalls the child once it fills) and
// only surfaces when the server never comes up — a startup crash is invisible otherwise
async function waitForServer(server: ChildProcess, origin: string, timeout = 30_000): Promise<void> {
  const output: string[] = [];

  const collect = (chunk: Buffer) => {
    output.push(chunk.toString());
  };

  server.stdout?.on('data', collect);
  server.stderr?.on('data', collect);

  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`${origin}/`);

      if (res.ok) return;
    } catch {
      // server not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const exit = server.exitCode === null ? '' : ` (exited with code ${server.exitCode})`;

  server.kill();

  throw new Error(`${origin} did not start within ${timeout}ms${exit}\n${output.join('')}`);
}
