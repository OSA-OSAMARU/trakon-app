#!/usr/bin/env node
// =============================================================================
// 層別カバレッジ集計
// -----------------------------------------------------------------------------
// 各 workspace の coverage/coverage-summary.json (vitest の json-summary レポータ生成)
// を読み込み、以下 3 層の行カバレッジ % を算出する:
//   - backend : apps/web/server/**
//   - frontend: apps/web/src/**
//   - shared  : packages/shared/src/**
//
// 標準出力に表を出し、CI (GITHUB_OUTPUT が設定されている場合) には
// be_pct / fe_pct / shared_pct を出力する。バッジ生成はこの値を使う。
// =============================================================================
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SUMMARIES = [
  path.join(root, 'apps/web/coverage/coverage-summary.json'),
  path.join(root, 'packages/shared/coverage/coverage-summary.json'),
];

/** path のマッチ条件で行カバレッジ (covered/total) を合算する。 */
function aggregate(predicate) {
  let covered = 0;
  let total = 0;
  for (const file of SUMMARIES) {
    if (!existsSync(file)) continue;
    const json = JSON.parse(readFileSync(file, 'utf8'));
    for (const [key, data] of Object.entries(json)) {
      if (key === 'total') continue;
      const norm = key.replaceAll('\\', '/');
      if (!predicate(norm)) continue;
      covered += data.lines.covered;
      total += data.lines.total;
    }
  }
  return { covered, total, pct: total === 0 ? 0 : (covered / total) * 100 };
}

const layers = {
  backend: aggregate((p) => p.includes('/apps/web/server/')),
  frontend: aggregate((p) => p.includes('/apps/web/src/')),
  shared: aggregate((p) => p.includes('/packages/shared/src/')),
};

const round1 = (n) => Math.round(n * 10) / 10;

console.log('Layer     | Lines covered | Lines total | Coverage');
console.log('----------|---------------|-------------|---------');
for (const [name, v] of Object.entries(layers)) {
  console.log(
    `${name.padEnd(9)} | ${String(v.covered).padStart(13)} | ${String(v.total).padStart(11)} | ${round1(v.pct)}%`,
  );
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `be_pct=${round1(layers.backend.pct)}`,
      `fe_pct=${round1(layers.frontend.pct)}`,
      `shared_pct=${round1(layers.shared.pct)}`,
      '',
    ].join('\n'),
  );
}
