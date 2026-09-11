import test from 'node:test';
import assert from 'node:assert/strict';

import { parseThemePref, resolveTheme } from '../src/lib/theme.ts';

test('parseThemePref accepts the three known values', () => {
  assert.equal(parseThemePref('system'), 'system');
  assert.equal(parseThemePref('dark'), 'dark');
  assert.equal(parseThemePref('light'), 'light');
});

test('parseThemePref falls back to system for null, missing, or garbage input', () => {
  assert.equal(parseThemePref(null), 'system');
  assert.equal(parseThemePref(''), 'system');
  assert.equal(parseThemePref('solarized'), 'system');
});

test('resolveTheme follows the OS when the preference is system', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
});

test('resolveTheme uses the explicit preference regardless of the OS', () => {
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
});
