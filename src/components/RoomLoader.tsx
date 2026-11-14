/** Loading picture: a dark room drawn in perspective, with a torch beam searching for the door. */
export function RoomLoader({ label, className = "" }: { label?: string; className?: string }) {
  // Room edges, in drawing order. pathLength=1 lets one dash animation draw every line.
  const edges = [
    "M70 50 H170 V130 H70 Z",
    "M70 50 L10 10",
    "M170 50 L230 10",
    "M170 130 L230 170",
    "M70 130 L10 170",
    "M10 10 H230 V170 H10 Z",
  ];
  return (
    <div className={`flex flex-col items-center gap-4 ${className}`} role="status">
      <svg viewBox="0 0 240 180" className="w-56 max-w-full" aria-hidden>
        <defs>
          <radialGradient id="torch">
            <stop offset="0" stopColor="#fde68a" stopOpacity="0.55" />
            <stop offset="0.6" stopColor="#fcd34d" stopOpacity="0.12" />
            <stop offset="1" stopColor="#fcd34d" stopOpacity="0" />
          </radialGradient>
          <clipPath id="room-clip">
            <rect x="10" y="10" width="220" height="160" />
          </clipPath>
        </defs>
        <g fill="none" stroke="#57534e" strokeWidth="1.5" strokeLinejoin="round">
          {edges.map((d, i) => (
            <path key={d} d={d} pathLength={1} className="loader-line" style={{ "--i": i } as React.CSSProperties} />
          ))}
        </g>
        {/* The door on the far wall. */}
        <path d="M106 130 V82 H134 V130" pathLength={1} fill="none" stroke="#a8a29e" strokeWidth="1.5" className="loader-line" style={{ "--i": 6 } as React.CSSProperties} />

        <g className="loader-keyhole" fill="#fcd34d">
          <circle cx="129" cy="108" r="2.2" />
          <rect x="128.2" y="108" width="1.6" height="5" rx="0.8" />
        </g>
        <g clipPath="url(#room-clip)">
          <circle cx="120" cy="96" r="52" fill="url(#torch)" className="loader-torch" />
        </g>
      </svg>
      {label && <p className="loader-dots text-sm text-stone-400">{label}</p>}
    </div>
  );
}
