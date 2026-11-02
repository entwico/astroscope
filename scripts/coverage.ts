// merges the e2e coverage of the spawned prod servers with the unit coverage of vitest, prints per
// directory how much the vitest workers, the servers and both together cover, and renders both into
// one html report with the sources (.coverage/report). run after
// `E2E_COVERAGE=1 vitest run --coverage` (`pnpm test:coverage` does both): the workers write
// coverage/lcov.info, the servers the raw v8 dumps in .coverage/v8
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import remapping, { type EncodedSourceMap } from '@jridgewell/remapping';
import { CoverageReport } from 'monocart-coverage-reports';

const REPO_DIR = resolve(import.meta.dirname, '..');
const COVERAGE_DIR = resolve(REPO_DIR, '.coverage');
const REPORT_DIR = resolve(COVERAGE_DIR, 'report');

const UNIT_LCOV = resolve(REPO_DIR, 'coverage/lcov.info');
const V8_DIR = resolve(COVERAGE_DIR, 'v8');
const E2E_DIR = resolve(COVERAGE_DIR, 'e2e');
const E2E_LINES = resolve(E2E_DIR, 'codecov.json');
const COMBINED_LCOV = resolve(COVERAGE_DIR, 'combined.lcov');

// a prod server chunk of a demo: the only scripts a v8 dump has that run package code from a build
const SERVER_CHUNK = /^demo\/[^/]+\/dist\/server\//;
const PACKAGE_SOURCE = /^packages\/[^/]+\/src\//;

type V8Script = { url: string; functions: unknown[] };

type V8Dump = { result: V8Script[] };

type Sample = { group: string; unit: number; e2e: number };

type Totals = { size: number; unit: number; e2e: number; combined: number };

type Position = { line: number; column: number };

// the istanbul file coverage the html report renders; only statements, the merged data has nothing else
type FileCoverage = {
  path: string;
  statementMap: Record<string, { start: Position; end: Position }>;
  s: Record<string, number>;
  fnMap: Record<string, never>;
  f: Record<string, never>;
  branchMap: Record<string, never>;
  b: Record<string, never>;
};

const fileCoverages = new Map<string, FileCoverage>();

function addStatement(path: string, start: Position, end: Position, hits: number): void {
  const coverage = fileCoverages.get(path) ?? { path, statementMap: {}, s: {}, fnMap: {}, f: {}, branchMap: {}, b: {} };
  const id = String(Object.keys(coverage.s).length);

  coverage.statementMap[id] = { start, end };
  coverage.s[id] = hits;
  fileCoverages.set(path, coverage);
}

// paths are kept relative to the repository: packages/node/src/...
function repoPath(path: string): string {
  return path.startsWith(`${REPO_DIR}/`) ? path.slice(REPO_DIR.length + 1) : path.replace(/^(\.\.\/)+/, '');
}

function formatPercent(part: number, whole: number, available: boolean): string {
  return available && whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '-';
}

function formatTable(title: string, samples: Sample[], hasE2e: boolean): string[] {
  const groups = new Map<string, Totals>();
  const total: Totals = { size: 0, unit: 0, e2e: 0, combined: 0 };

  for (const { group, unit, e2e } of samples) {
    const totals = groups.get(group) ?? { size: 0, unit: 0, e2e: 0, combined: 0 };

    for (const target of [totals, total]) {
      target.size += 1;
      target.unit += unit > 0 ? 1 : 0;
      target.e2e += e2e > 0 ? 1 : 0;
      target.combined += unit + e2e > 0 ? 1 : 0;
    }

    groups.set(group, totals);
  }

  const row = (name: string, size: string, ...percents: string[]) =>
    `${name.padEnd(48)} ${size.padStart(7)} ${percents.map((percent) => percent.padStart(9)).join(' ')}`;
  const format = (name: string, totals: Totals) =>
    row(
      name,
      String(totals.size),
      formatPercent(totals.unit, totals.size, true),
      formatPercent(totals.e2e, totals.size, hasE2e),
      formatPercent(totals.combined, totals.size, hasE2e),
    );

  return [
    title,
    row('', 'lines', 'unit', 'e2e', 'combined'),
    ...[...groups].toSorted(([a], [b]) => a.localeCompare(b)).map(([group, totals]) => format(group, totals)),
    format('total', total),
  ];
}

function readSourceMap(file: string): EncodedSourceMap | null {
  const map = `${file}.map`;

  return existsSync(map) ? (JSON.parse(readFileSync(map, 'utf8')) as EncodedSourceMap) : null;
}

// the chunk's map leads to packages/*/dist, whose tsdown maps lead on to src: composed into one map
function composeSourceMap(file: string): EncodedSourceMap | null {
  const map = readSourceMap(file);

  if (!map) {
    return null;
  }

  const composed = remapping({ ...map, file }, (source) => {
    const path = resolve(dirname(file), source);

    return /\/packages\/[^/]+\/dist\//.test(path) ? readSourceMap(path) : null;
  });

  return JSON.parse(composed.toString()) as EncodedSourceMap;
}

// the v8 dumps of every node process the suite spawned: only the prod server chunks of the demos
// carry package code with a map back to src. dev servers run the packages through vite's module
// runner, whose scripts do not match the files on disk, so they are not measured
async function convertE2e(): Promise<string[]> {
  if (!existsSync(V8_DIR) || readdirSync(V8_DIR).length === 0) {
    return [`e2e: no v8 dumps in ${V8_DIR}, the suite ran without E2E_COVERAGE`];
  }

  const entries: Record<string, unknown>[] = [];

  for (const name of readdirSync(V8_DIR)) {
    const dump = JSON.parse(readFileSync(resolve(V8_DIR, name), 'utf8')) as V8Dump;

    for (const script of dump.result) {
      if (!script.url.startsWith('file://')) {
        continue;
      }

      const file = fileURLToPath(script.url);

      if (!SERVER_CHUNK.test(relative(REPO_DIR, file))) {
        continue;
      }

      const sourceMap = composeSourceMap(file);

      // the chunks without a map are the re-export shells of the package entries
      if (!sourceMap) {
        continue;
      }

      entries.push({ url: script.url, source: readFileSync(file, 'utf8'), sourceMap, functions: script.functions });
    }
  }

  if (entries.length === 0) {
    return ['e2e: the v8 dumps hold no demo server chunks'];
  }

  const report = new CoverageReport({
    name: 'astroscope e2e coverage',
    outputDir: E2E_DIR,
    reports: ['codecov', 'lcovonly'],
    logging: 'error',
    sourceFilter: (sourcePath) => PACKAGE_SOURCE.test(repoPath(sourcePath)),
    sourcePath: (filePath) => repoPath(filePath),
  });

  await report.add(entries);
  await report.generate();

  return [`e2e: ${entries.length} server chunks of ${readdirSync(V8_DIR).length} processes, report in ${E2E_DIR}`];
}

// lcov: `SF:<file>` starts a file, `DA:<line>,<hits>` per executable line
function readLcov(path: string): Map<string, Map<number, number>> {
  const files = new Map<string, Map<number, number>>();
  let lines = new Map<number, number>();

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.startsWith('SF:')) {
      lines = new Map();
      files.set(repoPath(line.slice(3)), lines);
    } else if (line.startsWith('DA:')) {
      const [number = '', hits = ''] = line.slice(3).split(',', 2);

      lines.set(Number(number), Number(hits));
    }
  }

  return files;
}

// monocart's codecov json: per file every source line but blank and comment ones, with its count
// from the v8 byte ranges, or `1/<pieces>` when only a part of the line ran; a line that ran at all
// counts as executed, as in an lcov
function readLineCoverage(path: string): Map<string, Map<number, number>> {
  const { coverage } = JSON.parse(readFileSync(path, 'utf8')) as { coverage: Record<string, Record<string, number | string>> };
  const files = new Map<string, Map<number, number>>();

  for (const [file, lines] of Object.entries(coverage)) {
    files.set(repoPath(file), new Map(Object.entries(lines).map(([line, count]) => [Number(line), typeof count === 'number' ? count : 1])));
  }

  return files;
}

// vitest and monocart differ in their statement and branch maps, lines are what both agree on.
// vitest's executable lines are the basis (its include covers every package source file, loaded or
// not), the e2e hits are looked up per line
function merge(): string[] {
  if (!existsSync(UNIT_LCOV)) {
    return [`unit: no coverage in ${UNIT_LCOV} (\`vitest run --coverage\`)`];
  }

  const hasE2e = existsSync(E2E_LINES);
  const unit = readLcov(UNIT_LCOV);
  const e2e = hasE2e ? readLineCoverage(E2E_LINES) : new Map<string, Map<number, number>>();
  const samples: Sample[] = [];
  const combined: string[] = [];

  for (const [file, lines] of unit) {
    const e2eLines = e2e.get(file);
    // packages/node/src/islands/rewriter.ts → packages/node/src/islands
    const group = dirname(file).split('/').slice(0, 4).join('/');
    let covered = 0;

    const path = resolve(REPO_DIR, file);
    const source = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : [];

    combined.push('TN:', `SF:${file}`);

    for (const [line, unitHits] of lines) {
      const e2eHits = e2eLines?.get(line) ?? 0;

      samples.push({ group, unit: unitHits, e2e: e2eHits });
      combined.push(`DA:${line},${unitHits + e2eHits}`);
      addStatement(path, { line, column: 0 }, { line, column: source[line - 1]?.length ?? 0 }, unitHits + e2eHits);
      covered += unitHits + e2eHits > 0 ? 1 : 0;
    }

    combined.push(`LF:${lines.size}`, `LH:${covered}`, 'end_of_record');
  }

  writeFileSync(COMBINED_LCOV, `${combined.join('\n')}\n`);

  const packages = samples.map((sample) => ({ ...sample, group: sample.group.split('/').slice(0, 2).join('/') }));

  return [
    ...formatTable('line coverage per directory, executable lines as vitest counts them', samples, hasE2e),
    '',
    ...formatTable('line coverage per package', packages, hasE2e),
    `combined lcov: ${COMBINED_LCOV}`,
  ];
}

// one report for both, with the paths relative to the repository
async function generateReport(): Promise<string[]> {
  if (fileCoverages.size === 0) {
    return [];
  }

  const report = new CoverageReport({
    name: 'astroscope coverage: unit tests and e2e servers combined',
    outputDir: REPORT_DIR,
    reports: ['html'],
    logging: 'error',
    sourcePath: (filePath) => repoPath(filePath),
  });

  await report.add(Object.fromEntries(fileCoverages));
  await report.generate();

  // the data is merged by line: istanbul would show the empty 0/0 of branches and functions as
  // 100%, so the summaries and the file tables drop them
  appendFileSync(
    resolve(REPORT_DIR, 'base.css'),
    `
.pad1 > .clearfix > .fl:nth-child(2), .pad1 > .clearfix > .fl:nth-child(3),
.coverage-summary th:nth-child(n+5):nth-child(-n+8), .coverage-summary td:nth-child(n+5):nth-child(-n+8) { display: none; }
`,
  );

  return [`report: ${resolve(REPORT_DIR, 'index.html')}`];
}

const e2e = await convertE2e();
// the tables collect the data the report renders, so they come first
const tables = merge();
const report = await generateReport();

console.log(['', ...e2e, '', ...tables, ...report, ''].join('\n'));
