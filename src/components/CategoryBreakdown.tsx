import { useMemo } from 'react';
import type { Expense } from '../types/models';
import { totalsByCategory } from '../lib/projection';
import { useCategoryMap } from '../state/store';
import { Money, EmptyState } from './ui';
import { IconWallet } from './Icons';

/**
 * Categories are for insight, not sub-budgets (§4.3), so this reads as a
 * ranked list rather than a scoreboard: one stacked bar for composition, then
 * rows in size order. Bars beat a donut here — comparing lengths against a
 * shared baseline is easier than comparing arc angles, and the labels have
 * room to breathe.
 */
export function CategoryBreakdown({ expenses }: { expenses: Expense[] }) {
  const categories = useCategoryMap();
  const totals = useMemo(() => totalsByCategory(expenses), [expenses]);

  if (totals.length === 0) {
    return (
      <EmptyState icon={<IconWallet />} title="No spending logged yet">
        <span>Categories show up here as you log expenses.</span>
      </EmptyState>
    );
  }

  const max = totals[0].total;

  return (
    <div>
      <div
        className="row"
        style={{ gap: 2, marginBottom: 'var(--s-4)' }}
        role="img"
        aria-label={`Spending composition: ${totals
          .map((t) => `${categories.get(t.categoryId)?.name ?? 'Uncategorised'} ${Math.round(t.share * 100)}%`)
          .join(', ')}`}
      >
        {totals.map((t) => (
          <div
            key={t.categoryId}
            style={{
              flex: `${Math.max(t.share, 0.01)} 1 0`,
              height: 8,
              borderRadius: 'var(--r-pill)',
              background: categories.get(t.categoryId)?.color ?? 'var(--text-tertiary)',
            }}
          />
        ))}
      </div>

      <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
        {totals.map((t) => {
          const category = categories.get(t.categoryId);
          return (
            <div className="catbar" key={t.categoryId}>
              <div className="catbar__name">
                <span
                  className="dot"
                  style={{ background: category?.color ?? 'var(--text-tertiary)' }}
                />
                <span>{category?.name ?? 'Uncategorised'}</span>
              </div>
              <div className="catbar__amt">
                <Money amount={t.total} /> <span className="dim">· {Math.round(t.share * 100)}%</span>
              </div>
              <div className="catbar__track">
                <div
                  className="catbar__fill"
                  style={{
                    width: `${(t.total / max) * 100}%`,
                    background: category?.color ?? 'var(--text-tertiary)',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
