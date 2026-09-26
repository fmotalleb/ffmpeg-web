const PATHS: Record<string, React.ReactNode> = {
  pause: (
    <>
      <path d="M7 4.5v11" />
      <path d="M13 4.5v11" />
    </>
  ),
  play: <path d="M6.5 4.5 15 10l-8.5 5.5z" />,
  sliders: (
    <>
      <path d="M3 5.5h14" />
      <path d="M3 10h14" />
      <path d="M3 14.5h14" />
      <circle cx="13" cy="5.5" r="1.8" fill="var(--panel)" />
      <circle cx="7" cy="10" r="1.8" fill="var(--panel)" />
      <circle cx="11" cy="14.5" r="1.8" fill="var(--panel)" />
    </>
  ),
  export: (
    <>
      <path d="M4 15.5h12" />
      <path d="M10 12.5v-9" />
      <path d="m6.5 7 3.5-3.5L13.5 7" />
    </>
  ),
  import: (
    <>
      <path d="M4 15.5h12" />
      <path d="M10 3.5v9" />
      <path d="m6.5 9 3.5 3.5L13.5 9" />
    </>
  ),
  chevron: <path d="M5.5 8 10 12.5 14.5 8" />,
  star: <path d="M10 3l1.82 4.49 4.84-.33-3.71 3.8 1.16 4.7-4.11-2.56-4.11 2.56 1.16-4.7-3.71-3.8 4.84.33z" />,
  trash: (
    <>
      <path d="M3.5 5.5h13" />
      <path d="M8 5.5V3.5h4v2" />
      <path d="m5.5 5.5.8 11h7.4l.8-11" />
      <path d="M8.5 8.5v5M11.5 8.5v5" />
    </>
  ),
};

export function Icon({
  name,
  size = 14,
}: {
  name: keyof typeof PATHS | string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: "none" }}
    >
      {PATHS[name] ?? null}
    </svg>
  );
}
