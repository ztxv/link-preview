/** The app icon (same artwork as src/app/icon.svg), sized for the top bar. */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" width="28" height="28" aria-hidden="true">
      <rect width="64" height="64" rx="15" fill="#2F5BD3" />
      <g
        transform="translate(-1.5 .5) rotate(-45 32 32)"
        fill="none"
        stroke="#fff"
        strokeWidth="5.6"
        strokeLinecap="round"
      >
        <path d="M25 21.5H19a9.5 9.5 0 0 0 0 19h6M21 31h10m11.5 11.5V53" />
        <circle cx="42.5" cy="31" r="11.5" />
      </g>
    </svg>
  );
}
