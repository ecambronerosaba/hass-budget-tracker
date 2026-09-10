/**
 * Promoting a one-off expense to a monthly template.
 *
 * When someone ticks "make this recurring" while logging an expense, that
 * expense is the first occurrence of a `RecurringExpense`. If they already
 * have an active template by the same name — logging "Rent" again a month
 * after setting it up — the occurrence belongs to that one; making a second
 * "Rent" would double every projection and nudge. Otherwise it's a new
 * template, active from now, with the amount and day taken from what was just
 * entered (tweakable afterwards in Settings).
 */

import type { RecurringExpense } from '../types/models';

export interface RecurringTemplateDraft {
  description: string;
  amount: number;
  category: string;
  dayOfMonth: number;
}

export type RecurringResolution =
  | { kind: 'reuse'; id: string }
  | { kind: 'create'; template: Omit<RecurringExpense, 'id'> };

function normalize(description: string): string {
  return description.trim().toLowerCase();
}

export function resolveRecurringFromExpense(
  existing: RecurringExpense[],
  draft: RecurringTemplateDraft,
): RecurringResolution {
  const key = normalize(draft.description);
  const match = existing.find((r) => r.active && normalize(r.description) === key);
  if (match) return { kind: 'reuse', id: match.id };
  return {
    kind: 'create',
    template: {
      description: draft.description.trim(),
      amount: draft.amount,
      category: draft.category,
      dayOfMonth: draft.dayOfMonth,
      active: true,
    },
  };
}
