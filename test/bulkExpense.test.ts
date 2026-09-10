import test from 'node:test';
import assert from 'node:assert/strict';

import { partitionBulkRows, type BulkRow } from '../src/lib/bulkExpense.ts';

const row = (over: Partial<BulkRow>): BulkRow => ({
  amount: '',
  description: '',
  category: 'grocery',
  date: '2026-09-10',
  ...over,
});

const nothingLocked = () => false;

test('a row with neither amount nor description is blank, not an error', () => {
  const result = partitionBulkRows([row({}), row({ amount: '  ' })], nothingLocked);
  assert.deepEqual(result.blank, [0, 1]);
  assert.deepEqual(result.incomplete, []);
  assert.deepEqual(result.ready, []);
});

test('a row with an amount but no description is incomplete', () => {
  const result = partitionBulkRows([row({ amount: '12.40' })], nothingLocked);
  assert.deepEqual(result.incomplete, [0]);
  assert.deepEqual(result.ready, []);
});

test('a row with a description but no usable amount is incomplete', () => {
  const result = partitionBulkRows(
    [row({ description: 'Parking' }), row({ amount: '0', description: 'Free sample' })],
    nothingLocked,
  );
  assert.deepEqual(result.incomplete, [0, 1]);
  assert.deepEqual(result.ready, []);
});

test('a complete row is ready with a rounded amount and trimmed description', () => {
  const result = partitionBulkRows(
    [row({ amount: '$12.404', description: '  Trader Joe’s  ', category: 'grocery' })],
    nothingLocked,
  );
  assert.equal(result.ready.length, 1);
  assert.deepEqual(result.ready[0], {
    index: 0,
    monthId: '2026-09',
    input: {
      date: '2026-09-10',
      amount: 12.4,
      category: 'grocery',
      description: 'Trader Joe’s',
    },
  });
});

test('each ready row is routed to the month of its own date', () => {
  const result = partitionBulkRows(
    [
      row({ amount: '10', description: 'August thing', date: '2026-08-31' }),
      row({ amount: '20', description: 'September thing', date: '2026-09-01' }),
    ],
    nothingLocked,
  );
  assert.deepEqual(
    result.ready.map((r) => r.monthId),
    ['2026-08', '2026-09'],
  );
});

test('a row dated into a closed month is locked, not ready', () => {
  const result = partitionBulkRows(
    [
      row({ amount: '10', description: 'Old', date: '2026-07-15' }),
      row({ amount: '20', description: 'New', date: '2026-09-15' }),
    ],
    (monthId) => monthId === '2026-07',
  );
  assert.deepEqual(result.locked, [0]);
  assert.deepEqual(
    result.ready.map((r) => r.index),
    [1],
  );
});

test('a row with a malformed date is incomplete', () => {
  const result = partitionBulkRows(
    [row({ amount: '10', description: 'No date', date: '' })],
    nothingLocked,
  );
  assert.deepEqual(result.incomplete, [0]);
  assert.deepEqual(result.ready, []);
});

test('indices are reported against the original row order', () => {
  const result = partitionBulkRows(
    [
      row({}), // 0 blank
      row({ amount: '5', description: 'Coffee' }), // 1 ready
      row({ amount: '9' }), // 2 incomplete
    ],
    nothingLocked,
  );
  assert.deepEqual(result.blank, [0]);
  assert.deepEqual(
    result.ready.map((r) => r.index),
    [1],
  );
  assert.deepEqual(result.incomplete, [2]);
});
