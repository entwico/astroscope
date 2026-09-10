import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { latestResult, machineMeta, resultsDir, root, stamp } from './meta.ts';

// runs every *.bench.ts through vitest bench, keeps the json report next to
// the machine metadata, and compares each task against the newest previous
// report — vitest 5 dropped its own --outputJson/--compare, so the history and
// the comparison live here

interface Statistics {
  mean: number;
  p99: number;
  rme: number;
  samplesCount: number;
}

interface Task {
  name: string;
  latency: Statistics;
  throughput: Statistics;
}

interface Report {
  testResults: {
    name: string;
    assertionResults: { fullName: string; benchmarks?: { name: string; tasks: Task[] }[] }[];
  }[];
}

/** "file > test > task" → task, for every benchmark task in a report */
function indexTasks(report: Report): Map<string, Task> {
  const tasks = new Map<string, Task>();

  for (const file of report.testResults) {
    const relative = path.relative(root, file.name);

    for (const test of file.assertionResults) {
      for (const group of test.benchmarks ?? []) {
        for (const task of group.tasks) {
          tasks.set(`${relative} > ${test.fullName} > ${task.name}`, task);
        }
      }
    }
  }

  return tasks;
}

function readReport(file: string): Report | undefined {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Report>;

  return Array.isArray(parsed.testResults) ? (parsed as Report) : undefined;
}

const micros = (ms: number): string => `${(ms * 1000).toFixed(2)} µs`;

function printComparison(current: Report, previous: Report): void {
  const before = indexTasks(previous);
  const rows: string[][] = [];

  for (const [key, task] of indexTasks(current)) {
    const old = before.get(key);
    const delta = old ? ((task.latency.mean - old.latency.mean) / old.latency.mean) * 100 : undefined;

    rows.push([
      key,
      micros(task.latency.mean),
      `±${task.latency.rme.toFixed(2)}%`,
      old ? micros(old.latency.mean) : 'n/a',
      delta === undefined ? '' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`,
    ]);
  }

  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));

  console.log('\nmean latency vs previous run (negative is faster):\n');

  for (const row of rows) {
    console.log(row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!))).join('  '));
  }
}

mkdirSync(resultsDir, { recursive: true });

const previous = latestResult('micro');
const out = path.join(resultsDir, `micro-${stamp()}.json`);
const args = [
  'vitest',
  'bench',
  '--run',
  '--reporter=default',
  '--reporter=json',
  `--outputFile.json=${out}`,
  ...process.argv.slice(2),
];

if (previous) console.log(`comparing against ${path.relative(root, previous)}\n`);

// vitest defaults NODE_ENV to test, which makes react-dom load its development build
const { status } = spawnSync('npx', args, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});

writeFileSync(out.replace(/\.json$/, '.meta.json'), `${JSON.stringify(machineMeta(), null, 2)}\n`);

if (status === 0 && previous) {
  const before = readReport(previous);

  if (before) {
    printComparison(readReport(out)!, before);
  } else {
    console.log('\nprevious result predates vitest 5 (no testResults), nothing to compare against');
  }
}

console.log(`\nresult written to ${path.relative(root, out)}`);
process.exit(status ?? 1);
