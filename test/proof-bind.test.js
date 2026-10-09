// Proof CLI (src/eval/proofBind.mjs): the `--set param=value` sample override
// — used by the 004 part-binding proof (a fresh scaffold of
// LSB-2607-004-FHL-R00.pdf rendered via `ladder proof <dir> --set dim1=1000`).
// Parsing only — runProof itself needs Inkscape + poppler and is exercised by
// generating the proof artifacts.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseOverrides } from '../src/eval/proofBind.mjs';

test('parseOverrides: empty args, no overrides', () => {
  assert.deepEqual(parseOverrides([]), { set: {} });
  assert.deepEqual(parseOverrides(['--verbose']), { set: {} });
});

test('parseOverrides: single and repeated --set', () => {
  assert.deepEqual(parseOverrides(['--set', 'dim1=1000']), { set: { dim1: '1000' } });
  assert.deepEqual(
    parseOverrides(['--set', 'dim1=1000', '--set', 'customer=ACME SDN BHD']),
    { set: { dim1: '1000', customer: 'ACME SDN BHD' } },
  );
});

test('parseOverrides: values may contain = and comma numbers', () => {
  assert.deepEqual(parseOverrides(['--set', 'dim1=1,000.00']), { set: { dim1: '1,000.00' } });
  assert.deepEqual(parseOverrides(['--set', 'x=a=b']), { set: { x: 'a=b' } });
});

test('parseOverrides: malformed --set throws', () => {
  assert.throws(() => parseOverrides(['--set']), /param=value/);
  assert.throws(() => parseOverrides(['--set', 'dim1']), /param=value/);
  assert.throws(() => parseOverrides(['--set', '=1000']), /param=value/);
});
