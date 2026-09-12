import { useMemo, useState } from 'react';
import { BucketDetail } from './BucketDetail';
import { BucketSheet } from '../components/BucketSheet';
import { IconBucket } from '../components/Icons';
import { EmptyState, Money, SectionHeading, useMoneyFormatter } from '../components/ui';
import { summarizeBucket } from '../lib/bucket';
import type { Bucket } from '../types/models';
import { useApp, useCategoryMap } from '../state/store';

const PHASE_LABEL: Record<Bucket['phase'], string> = {
  saving: 'Saving',
  spending: 'Spending',
  closed: 'Closed',
};

/**
 * Budgets that aren't months: a trip, a wedding, new golf clubs. Same
 * drill-in shape as History — a list here, one thing at a time in the detail
 * — because a bucket is read one at a time and the list is only ever a few
 * rows long.
 */
export function BucketsScreen() {
  const { buckets, expenses } = useApp();
  const categories = useCategoryMap();
  const money = useMoneyFormatter();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(
    () =>
      buckets.map((bucket) => ({
        bucket,
        summary: summarizeBucket({
          bucket,
          expenses: expenses.filter((e) => e.bucketId === bucket.id),
        }),
      })),
    [buckets, expenses],
  );

  const active = rows.filter((r) => r.bucket.phase !== 'closed');
  const closed = rows.filter((r) => r.bucket.phase === 'closed');

  if (open) {
    // A bucket deleted out from under this view falls back to the list rather
    // than rendering a blank detail screen.
    if (!rows.some((r) => r.bucket.id === open)) {
      setOpen(null);
      return null;
    }
    return <BucketDetail bucketId={open} onBack={() => setOpen(null)} />;
  }

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
      <div className="row row--between" style={{ gap: 'var(--s-3)', alignItems: 'flex-start' }}>
        <div>
          <div className="section-label">Buckets</div>
          <p className="muted" style={{ fontSize: 'var(--t-small)', marginTop: 4 }}>
            A budget that isn't a month. Save toward it, then spend from it.
          </p>
        </div>
        <button className="btn btn--primary btn--sm" onClick={() => setCreating(true)}>
          New bucket
        </button>
      </div>

      {rows.length === 0 ? (
        <section className="card">
          <EmptyState icon={<IconBucket />} title="No buckets yet">
            <span>
              A trip, a wedding, new golf clubs — anything you save up for separately.
            </span>
          </EmptyState>
        </section>
      ) : (
        active.length > 0 && (
          <section className="card card--flush">
            <div className="list">
              {active.map(({ bucket, summary }) => (
                <BucketRow
                  key={bucket.id}
                  bucket={bucket}
                  fraction={
                    bucket.phase === 'spending' ? summary.fractionSpent : summary.fractionSaved
                  }
                  color={categories.get(bucket.category)?.color ?? 'var(--text-tertiary)'}
                  sub={
                    bucket.phase === 'spending'
                      ? `${PHASE_LABEL[bucket.phase]} · ${money(summary.spent)} of ${money(
                          summary.saved,
                          { compact: true },
                        )} in the fund`
                      : `${PHASE_LABEL[bucket.phase]} · ${money(summary.saved)} of ${money(
                          summary.target,
                          { compact: true },
                        )}`
                  }
                  amount={
                    bucket.phase === 'spending' ? summary.fundRemaining : summary.targetRemaining
                  }
                  amountNote={bucket.phase === 'spending' ? 'left in fund' : 'still to save'}
                  onOpen={() => setOpen(bucket.id)}
                />
              ))}
            </div>
          </section>
        )
      )}

      {closed.length > 0 && (
        <>
          <SectionHeading title="Closed" />
          <section className="card card--flush">
            <div className="list">
              {closed.map(({ bucket, summary }) => (
                <BucketRow
                  key={bucket.id}
                  bucket={bucket}
                  fraction={summary.fractionSpent}
                  color={categories.get(bucket.category)?.color ?? 'var(--text-tertiary)'}
                  sub={`Closed · ${money(summary.spent)} spent of ${money(summary.saved, {
                    compact: true,
                  })} saved`}
                  amount={summary.fundRemaining}
                  amountNote="left over"
                  onOpen={() => setOpen(bucket.id)}
                />
              ))}
            </div>
          </section>
        </>
      )}

      {creating && (
        <BucketSheet
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setOpen(id);
          }}
        />
      )}
    </div>
  );
}

function BucketRow({
  bucket,
  fraction,
  color,
  sub,
  amount,
  amountNote,
  onOpen,
}: {
  bucket: Bucket;
  fraction: number;
  color: string;
  sub: string;
  amount: number;
  amountNote: string;
  onOpen: () => void;
}) {
  const money = useMoneyFormatter();
  return (
    <button
      className="list__item bucketrow"
      onClick={onOpen}
      aria-label={`${bucket.name}, ${sub}, ${money(amount)} ${amountNote}`}
    >
      <span className="dot" style={{ background: color }} />
      <span className="list__main">
        <span className="list__title" style={{ opacity: bucket.phase === 'closed' ? 0.6 : 1 }}>
          {bucket.name}
        </span>
        <span className="list__sub">
          <span>{sub}</span>
        </span>
        <span className="catbar__track" style={{ marginTop: 6 }} aria-hidden="true">
          <span
            className="catbar__fill"
            style={{
              width: `${Math.min(100, Math.max(0, fraction * 100))}%`,
              background: color,
            }}
          />
        </span>
      </span>
      <span className="list__amount num">
        <Money amount={amount} compact />
      </span>
    </button>
  );
}
