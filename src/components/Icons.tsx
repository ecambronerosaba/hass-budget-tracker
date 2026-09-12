/** Minimal line icons — one weight, one grid, no fill. */

type Props = { className?: string; strokeWidth?: number };

function Svg({
  children,
  className,
  strokeWidth = 1.6,
}: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

export const IconPlus = (p: Props) => (
  <Svg {...p} strokeWidth={2}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconHome = (p: Props) => (
  <Svg {...p}>
    <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />
  </Svg>
);

export const IconList = (p: Props) => (
  <Svg {...p}>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </Svg>
);

export const IconReconcile = (p: Props) => (
  <Svg {...p}>
    <path d="M4 8h11l-2.5-2.5M20 16H9l2.5 2.5" />
    <path d="M20 8v0M4 16v0" />
  </Svg>
);

export const IconHistory = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7.5V12l3 1.8" />
  </Svg>
);

export const IconSettings = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1" />
  </Svg>
);

export const IconCheck = (p: Props) => (
  <Svg {...p} strokeWidth={2}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Svg>
);

export const IconClose = (p: Props) => (
  <Svg {...p} strokeWidth={2}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const IconArrowLeft = (p: Props) => (
  <Svg {...p}>
    <path d="M19 12H5m0 0 6-6m-6 6 6 6" />
  </Svg>
);

export const IconArrowRight = (p: Props) => (
  <Svg {...p}>
    <path d="M5 12h14m0 0-6-6m6 6-6 6" />
  </Svg>
);

export const IconInfo = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);

export const IconTrendUp = (p: Props) => (
  <Svg {...p}>
    <path d="M4 16.5 10 10l4 4 6-6.5" />
    <path d="M15.5 7.5H20V12" />
  </Svg>
);

export const IconTrendDown = (p: Props) => (
  <Svg {...p}>
    <path d="M4 8.5 10 15l4-4 6 6.5" />
    <path d="M15.5 17.5H20V13" />
  </Svg>
);

export const IconRepeat = (p: Props) => (
  <Svg {...p}>
    <path d="M4 9a4 4 0 0 1 4-4h9l-2.5-2.5M20 15a4 4 0 0 1-4 4H7l2.5 2.5" />
  </Svg>
);

export const IconUpload = (p: Props) => (
  <Svg {...p}>
    <path d="M12 16V5m0 0L8 9m4-4 4 4" />
    <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
  </Svg>
);

export const IconDownload = (p: Props) => (
  <Svg {...p}>
    <path d="M12 5v11m0 0 4-4m-4 4-4-4" />
    <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
  </Svg>
);

export const IconEdit = (p: Props) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
  </Svg>
);

export const IconTrash = (p: Props) => (
  <Svg {...p}>
    <path d="M4.5 6.5h15M9 6.5V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5" />
    <path d="M6.5 6.5 7.5 20h9l1-13.5" />
  </Svg>
);

export const IconWallet = (p: Props) => (
  <Svg {...p}>
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <path d="M16 13h.01" />
  </Svg>
);

export const IconInbox = (p: Props) => (
  <Svg {...p}>
    <path d="M4 13h4l1.5 2.5h5L16 13h4" />
    <path d="M5.5 5h13L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5z" />
  </Svg>
);

export const IconLink = (p: Props) => (
  <Svg {...p}>
    <path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.54 3.54 0 0 0-5-5L11.5 7.5" />
    <path d="M13.5 10.5a3.5 3.5 0 0 0-5 0L6 13a3.54 3.54 0 0 0 5 5l1.5-1.5" />
  </Svg>
);

export const IconFlag = (p: Props) => (
  <Svg {...p}>
    <path d="M6 21V4" />
    <path d="M6 4.5h11l-2 3.5 2 3.5H6" />
  </Svg>
);

export const IconLock = (p: Props) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
);
