import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const specs = new URL('./tests/', import.meta.url);
const scenarios = new URL('../scenarios/visual/', import.meta.url);
const pending = new Set(readdirSync(scenarios).filter((name) => name.endsWith('.md')));
let count = 0;
for (const file of readdirSync(specs).filter((name) => name.endsWith('.spec.ts'))) {
  const companion = file.replace('.spec.ts', '.md');
  assert(pending.delete(companion), `${file}: missing scenario companion`);
  const source = readFileSync(new URL(file, specs), 'utf8');
  const markdown = readFileSync(new URL(companion, scenarios), 'utf8');
  const titles = [...source.matchAll(/\btest\(\s*'([^']+)'/g)].map((match) => match[1]);
  const headings = [...markdown.matchAll(/^## Scenario: (.+)$/gm)].map((match) => match[1]);
  assert(titles.length > 0, `${file}: no literal test titles found`);
  assert.deepEqual([...titles].sort(), [...headings].sort(), `${file}: scenario titles differ`);
  count += titles.length;
}
assert.equal(pending.size, 0, `Orphan visual scenarios: ${[...pending].join(', ')}`);
console.log(`Visual scenario parity: ${count} tests paired (structural check only).`);
