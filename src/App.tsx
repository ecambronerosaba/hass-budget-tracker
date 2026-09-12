import { useState } from 'react';
import { Dashboard } from './screens/Dashboard';
import { ExpensesScreen } from './screens/ExpensesScreen';
import { ReconcileScreen } from './screens/ReconcileScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { BucketsScreen } from './screens/BucketsScreen';
import { ExpenseSheet } from './components/ExpenseSheet';
import { Toasts } from './components/ui';
import {
  IconBucket,
  IconHistory,
  IconHome,
  IconList,
  IconPlus,
  IconReconcile,
  IconSettings,
} from './components/Icons';
import { currentMonthId, monthLabel, shiftMonth } from './lib/dates';
import { useApp, useMonth } from './state/store';
import { useTheme } from './state/useTheme';

export type Screen =
  | 'dashboard'
  | 'expenses'
  | 'buckets'
  | 'reconcile'
  | 'history'
  | 'settings';

const TABS: { id: Screen; label: string; Icon: typeof IconHome }[] = [
  { id: 'dashboard', label: 'Month', Icon: IconHome },
  { id: 'expenses', label: 'Expenses', Icon: IconList },
  { id: 'buckets', label: 'Buckets', Icon: IconBucket },
  { id: 'reconcile', label: 'Reconcile', Icon: IconReconcile },
  { id: 'history', label: 'History', Icon: IconHistory },
  { id: 'settings', label: 'Settings', Icon: IconSettings },
];

export function App() {
  const { status, error, activeMonthId, setActiveMonthId } = useApp();
  const month = useMonth(activeMonthId);
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [adding, setAdding] = useState(false);
  useTheme();

  if (status === 'loading') {
    return <div className="empty" style={{ paddingTop: '30vh' }}>Opening your budget…</div>;
  }

  if (status === 'error') {
    return (
      <div className="app__main">
        <div className="card">
          <h1 style={{ fontSize: 'var(--t-heading)', fontWeight: 600, marginBottom: 8 }}>
            Storage wouldn't open
          </h1>
          <p className="muted" style={{ fontSize: 'var(--t-small)' }}>
            {error ?? 'Something went wrong reading local data.'}
          </p>
        </div>
      </div>
    );
  }

  const isCurrent = activeMonthId === currentMonthId();
  const canAdd = month?.status === 'open';

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner">
          <div>
            <div className="topbar__title">{monthLabel(activeMonthId)}</div>
            <div className="topbar__sub">
              {month?.status === 'reconciled' ? 'Closed' : isCurrent ? 'In progress' : 'Open'}
            </div>
          </div>
          <div className="row" style={{ gap: 'var(--s-2)' }}>
            <button
              className="btn btn--ghost btn--sm"
              aria-label="Previous month"
              onClick={() => setActiveMonthId(shiftMonth(activeMonthId, -1))}
            >
              ‹
            </button>
            <button
              className="btn btn--ghost btn--sm"
              aria-label="Next month"
              disabled={activeMonthId >= currentMonthId()}
              onClick={() => setActiveMonthId(shiftMonth(activeMonthId, 1))}
            >
              ›
            </button>
          </div>
        </div>
      </header>

      <main className="app__main">
        {screen === 'dashboard' && <Dashboard onNavigate={setScreen} />}
        {screen === 'expenses' && <ExpensesScreen />}
        {screen === 'buckets' && <BucketsScreen />}
        {screen === 'reconcile' && <ReconcileScreen />}
        {screen === 'history' && <HistoryScreen />}
        {screen === 'settings' && <SettingsScreen />}
      </main>

      {canAdd && screen !== 'reconcile' && screen !== 'buckets' && (
        <button className="fab" onClick={() => setAdding(true)} aria-label="Log an expense">
          <IconPlus />
        </button>
      )}

      <nav className="tabbar" aria-label="Sections">
        <div className="tabbar__inner">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className="tab"
              aria-current={screen === id ? 'page' : undefined}
              onClick={() => setScreen(id)}
            >
              <Icon />
              {label}
            </button>
          ))}
        </div>
      </nav>

      {adding && <ExpenseSheet monthId={activeMonthId} onClose={() => setAdding(false)} />}
      <Toasts />
    </div>
  );
}
