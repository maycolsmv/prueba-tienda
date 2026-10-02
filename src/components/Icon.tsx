const paths = {
  home: 'M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z',
  dashboard: 'M4 4h7v9H4z M13 4h7v5h-7z M13 11h7v9h-7z M4 15h7v5H4z',
  sell: 'M4 5h2l2.4 10.2a1 1 0 001 .8h8.2a1 1 0 001-.8L20 8H7 M10 20a1 1 0 100-2 1 1 0 000 2z M17 20a1 1 0 100-2 1 1 0 000 2z',
  sales: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6',
  products: 'M8 4l-5 3 2 5 2-1v9h10v-9l2 1 2-5-5-3c-.5 2-2 3-4 3s-3.5-1-4-3z',
  inventory: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
  customers: 'M9 11a4 4 0 100-8 4 4 0 000 8z M2 21v-1a6 6 0 0112 0v1 M16 3.5a4 4 0 010 7 M18 14a6 6 0 014 6v1',
  reports: 'M4 20V10 M10 20V4 M16 20v-8 M22 20H2',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-2.9-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 003 15H3a2 2 0 110-4h.1a1.7 1.7 0 001.2-2.9l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 009 4.6V3a2 2 0 114 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1A1.7 1.7 0 0021 9h.1a2 2 0 110 4H21a1.7 1.7 0 00-1.6 2z',
  money: 'M3 6h18v12H3z M12 15a3 3 0 100-6 3 3 0 000 6z M6 9v.01 M18 15v.01',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6 M9 16h3',
  ticket: 'M3 8a2 2 0 002-2h14a2 2 0 002 2v2a2 2 0 000 4v2a2 2 0 00-2 2H5a2 2 0 00-2-2v-2a2 2 0 000-4z M10 6v12',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
  percent: 'M19 5L5 19 M6.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5z M17.5 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  wallet: 'M3 7a2 2 0 012-2h13v4 M3 7v11a2 2 0 002 2h15V9H5a2 2 0 01-2-2z M16 14.5v.01',
  warehouse: 'M3 21V8l9-5 9 5v13 M7 21v-8h10v8 M7 17h10',
  alert: 'M12 3l10 18H2z M12 10v4 M12 17.5v.01',
  arrowUp: 'M7 14l5-5 5 5',
  arrowDown: 'M7 10l5 5 5-5',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  plus: 'M12 5v14 M5 12h14',
  chart: 'M3 3v18h18 M7 15l4-4 3 3 5-6',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18z M12 7v5l3 2',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
