import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import autocannon from 'autocannon';
import { latestResult, machineMeta, resultsDir, root, stamp } from './meta.ts';

/**
 * end-to-end throughput of the built demo/node-e2e server, per variant:
 * the react integration in use and the platform (request logging + telemetry)
 * on or off. each variant is built into its own out dir, served, warmed up,
 * and hit with autocannon per page. results are compared against the newest
 * previous run; a throughput drop beyond the threshold fails the run.
 */

const fixtureRoot = path.join(root, 'demo/node-e2e');
// inside the fixture: prerendering resolves the fixture's dependencies from the out dir
const outRoot = path.join(fixtureRoot, '.bench');
const duration = Number(process.env['BENCH_DURATION'] ?? 10);
const connections = Number(process.env['BENCH_CONNECTIONS'] ?? 50);
const threshold = Number(process.env['BENCH_THRESHOLD'] ?? 10);
const only = process.argv.slice(2);

const variants: Record<string, Record<string, string>> = {
  astroscope: {},
  upstream: { BENCH_REACT: 'upstream' },
  'platform-off': { BENCH_PLATFORM: 'off' },
};

const pages: Record<string, string> = {
  'one island': '/',
  'twenty islands': '/many',
  'suspending islands': '/suspense',
  prerendered: '/static',
};

const port = 21000 + (process.pid % 1000);

async function build(name: string, env: Record<string, string>): Promise<string> {
  const outDir = path.join(outRoot, name);

  rmSync(outDir, { recursive: true, force: true });

  // vitest-style env hygiene: a non-production NODE_ENV flips the react plugin to the dev jsx runtime
  execSync('npx astro build --silent', {
    cwd: fixtureRoot,
    env: { ...process.env, ...env, NODE_ENV: 'production', BENCH_OUT_DIR: outDir },
    stdio: 'inherit',
  });

  return outDir;
}

async function serve(outDir: string): Promise<ChildProcess> {
  const server = spawn('node', ['server/entry.mjs'], {
    cwd: outDir,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      HEALTH_HOST: '127.0.0.1',
      HEALTH_PORT: String(port + 1),
      OTEL_EXPORTER_PROMETHEUS_HOST: '127.0.0.1',
      OTEL_EXPORTER_PROMETHEUS_PORT: String(port + 2),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return server;
    } catch {
      // not listening yet
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  server.kill('SIGKILL');
  throw new Error('server did not start');
}

function rssMb(pid: number | undefined): number {
  return Math.round(Number(execSync(`ps -o rss= -p ${pid}`).toString().trim()) / 1024);
}

interface PageResult {
  rps: number;
  p50: number;
  p99: number;
  errors: number;
}

interface VariantResult {
  pages: Record<string, PageResult>;
  rssMb: number;
}

async function measure(url: string, seconds: number): Promise<PageResult> {
  const result = await autocannon({ url, connections, duration: seconds, pipelining: 1 });

  return {
    rps: Math.round(result.requests.average),
    p50: result.latency.p50,
    p99: result.latency.p99,
    errors: result.errors + result.non2xx,
  };
}

async function runVariant(name: string, env: Record<string, string>): Promise<VariantResult> {
  const outDir = await build(name, env);
  const server = await serve(outDir);
  const pageResults: Record<string, PageResult> = {};

  try {
    await measure(`http://127.0.0.1:${port}/`, 2);

    for (const [label, route] of Object.entries(pages)) {
      pageResults[label] = await measure(`http://127.0.0.1:${port}${route}`, duration);
    }

    return { pages: pageResults, rssMb: rssMb(server.pid) };
  } finally {
    server.kill('SIGKILL');
    await new Promise((resolve) => server.once('exit', resolve));
  }
}

function delta(now: number, before: number | undefined): string {
  if (!before) return '';

  const pct = ((now - before) / before) * 100;

  return ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
}

function report(results: Record<string, VariantResult>, previous: Record<string, VariantResult> | undefined): string[] {
  const failures: string[] = [];

  for (const [variant, { pages: pageResults, rssMb }] of Object.entries(results)) {
    console.log(`\n${variant}  rss ${rssMb} MB${delta(rssMb, previous?.[variant]?.rssMb)}`);
    console.log('  page                   req/s              p50 ms   p99 ms   errors');

    for (const [page, r] of Object.entries(pageResults)) {
      const before = previous?.[variant]?.pages[page];
      const rps = `${r.rps}${delta(r.rps, before?.rps)}`;

      console.log(
        `  ${page.padEnd(22)} ${rps.padEnd(18)} ${String(r.p50).padEnd(8)} ${String(r.p99).padEnd(8)} ${r.errors}`,
      );

      if (before && r.rps < before.rps * (1 - threshold / 100)) {
        failures.push(`${variant} / ${page}: ${before.rps} -> ${r.rps} req/s`);
      }
    }
  }

  return failures;
}

mkdirSync(resultsDir, { recursive: true });

const previousFile = latestResult('macro');
const previous = previousFile
  ? (JSON.parse(readFileSync(previousFile, 'utf8')) as { results: Record<string, VariantResult> }).results
  : undefined;
const results: Record<string, VariantResult> = {};

for (const [name, env] of Object.entries(variants)) {
  if (only.length && !only.includes(name)) continue;

  console.log(`\n=== ${name} ===`);
  results[name] = await runVariant(name, env);
}

if (previousFile) console.log(`\ncompared against ${path.relative(root, previousFile)}`);

const failures = report(results, previous);
const out = path.join(resultsDir, `macro-${stamp()}.json`);

writeFileSync(out, `${JSON.stringify({ meta: { ...machineMeta(), duration, connections }, results }, null, 2)}\n`);
console.log(`\nresult written to ${path.relative(root, out)}`);

if (failures.length) {
  console.error(`\nthroughput dropped more than ${threshold}%:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
