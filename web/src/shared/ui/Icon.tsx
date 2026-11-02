// Inline SVG icons (24×24, 1.75px strokes, currentColor). Bundled rather
// than loaded from an icon CDN: the app must run with no network access
// (APP_DESIGN.md §17.4).

const PATHS = {
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />,
  undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  redo: <path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />,
  save: <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM8 3v5h7V3M8 21v-7h8v7" />,
  download: <path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
  upload: <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />,
  report: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  sun: <path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m11.32 0 1.41 1.41M4.93 4.93l1.41 1.41M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  monitor: <path d="M3 5h18v11H3zM8 20h8M12 16v4" />,
  trash: <path d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />,
  music: <path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />,
  metronome: <path d="M8.5 3h7L20 21H4zM12 16l5-9M7 16h10" />,
  loop: <path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3m13-3v2a4 4 0 0 1-4 4H4" />,
  zoomIn: <path d="M11 8v6M8 11h6M20 20l-4.35-4.35M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0z" />,
  zoomOut: <path d="M8 11h6M20 20l-4.35-4.35M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0z" />,
  printer: <path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z" />,
  sliders: <path d="M6 3v7m0 4v7M12 3v3m0 4v11M18 3v11m0 4v3M3.5 12h5M9.5 8h5M15.5 16h5" />,
  volume: <path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  arrowUp: <path d="M12 19V5m0 0-6 6m6-6 6 6" />,
  arrowDown: <path d="M12 5v14m0 0-6-6m6 6 6-6" />,
  layers: <path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5" />,
  crosshair: <path d="M12 3v4m0 10v4M3 12h4m10 0h4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
  file: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" />,
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

/** A decorative icon; the surrounding control carries the accessible name. */
export function Icon({ name, size = 18, className }: IconProps) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
