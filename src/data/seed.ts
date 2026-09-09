import type { AppSettings, Category } from '../types/models';

/**
 * Starter categories (PRD §3.2). Colors are muted natural tones drawn from the
 * same Nordic palette as the rest of the app — distinguishable from one
 * another without any of them shouting.
 */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat_groceries',     name: 'Groceries',              color: '#93b58c', isDefault: true, archived: false },
  { id: 'cat_dining',        name: 'Dining & Takeout',       color: '#c99274', isDefault: true, archived: false },
  { id: 'cat_transport',     name: 'Transport',              color: '#7ba7d9', isDefault: true, archived: false },
  { id: 'cat_bills',         name: 'Bills & Subscriptions',  color: '#9a93c4', isDefault: true, archived: false },
  { id: 'cat_shopping',      name: 'Shopping',               color: '#c98fa8', isDefault: true, archived: false },
  { id: 'cat_entertainment', name: 'Entertainment',          color: '#6fa8a0', isDefault: true, archived: false },
  { id: 'cat_health',        name: 'Health & Personal Care', color: '#c6b27e', isDefault: true, archived: false },
  { id: 'cat_other',         name: 'Other',                  color: '#8a9199', isDefault: true, archived: false },
];

export const FALLBACK_CATEGORY_ID = 'cat_other';

/** Palette offered when the user adds or recolors a category. */
export const CATEGORY_PALETTE = [
  '#93b58c', '#c99274', '#7ba7d9', '#9a93c4',
  '#c98fa8', '#6fa8a0', '#c6b27e', '#8a9199',
  '#a8b57f', '#cf8b84', '#7f9dbe', '#b3a2c9',
];

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'settings',
  currency: 'USD',
  theme: 'dark',
};
