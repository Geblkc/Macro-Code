/**
 * Karşılama ekranı — boş oturumda gösterilir.
 * Sadece marka: logo + ürün adı.
 */
export default function Welcome() {
  return (
    <div className="welcome">
      <svg
        className="welcome-logo"
        viewBox="0 0 512 512"
        aria-hidden="true"
        role="presentation"
      >
        <defs>
          <filter id="welcome-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="9" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect width="512" height="512" rx="112" fill="#000" />
        <g
          transform="translate(-4,-14)"
          fill="none"
          stroke="#00E676"
          strokeWidth="36"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#welcome-glow)"
        >
          {/* m */}
          <path d="M90 335 V205 M90 250 C90 220 115 205 138 205 C163 205 185 220 185 250 V335 M185 250 C185 220 208 205 232 205 C257 205 280 220 280 250 V335" />
          {/* < */}
          <path d="M430 165 L340 270 L430 375" />
        </g>
      </svg>
      <h1>MacroCode</h1>
    </div>
  );
}
