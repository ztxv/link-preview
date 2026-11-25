/** The app icon (same artwork as src/app/icon.svg), sized for the top bar. */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" width="28" height="28" aria-hidden="true">
      <defs>
        <linearGradient id="brand-bg" x1="8" y1="0" x2="56" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6b8bff" />
          <stop offset="1" stopColor="#3a46d6" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#brand-bg)" />
      <g fill="none">
        <rect x="-14" y="-8" width="28" height="16" rx="8" transform="translate(27 27) rotate(-45) translate(-7.5 -2.5)" stroke="#fff" strokeWidth="4.6" />
        <rect x="-14" y="-8" width="28" height="16" rx="8" transform="translate(27 27) rotate(-45) translate(7.5 2.5)" stroke="#4a5de8" strokeWidth="8" />
        <rect x="-14" y="-8" width="28" height="16" rx="8" transform="translate(27 27) rotate(-45) translate(7.5 2.5)" stroke="#fff" strokeWidth="4.6" />
      </g>
      <circle cx="41" cy="41" r="11.5" fill="#2a3ac0" fillOpacity=".45" />
      <circle cx="41" cy="41" r="11.5" fill="none" stroke="#ffd166" strokeWidth="4.4" />
      <path d="M49.3 49.3 L57 57" stroke="#ffd166" strokeWidth="6.6" strokeLinecap="round" />
    </svg>
  );
}
