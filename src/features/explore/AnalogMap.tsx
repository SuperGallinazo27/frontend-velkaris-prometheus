import { candidates } from "../../data/demo";
export function AnalogMap({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="map-canvas">
      <svg
        className="world"
        viewBox="0 0 800 400"
        preserveAspectRatio="none"
        role="img"
        aria-label="Mapa esquemático de la Tierra con tres candidatos terrestres; no es cartografía científica"
      >
        <defs>
          <pattern
            id="grid"
            width="50"
            height="50"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 50 0 L 0 0 0 50"
              fill="none"
              stroke="#344845"
              strokeWidth="0.6"
            />
          </pattern>
          <radialGradient id="sea">
            <stop stopColor="#263f3b" />
            <stop offset="1" stopColor="#152823" />
          </radialGradient>
        </defs>
        <rect width="800" height="400" fill="url(#sea)" />
        <rect width="800" height="400" fill="url(#grid)" />
        <g fill="#3f5550" stroke="#779087" strokeWidth="1" opacity=".8">
          <path d="M70 85 108 55 180 44 220 65 260 78 242 110 208 122 191 151 164 157 145 177 111 145 92 119Z M167 167 197 181 235 207 252 247 229 288 215 331 190 350 185 306 169 269 175 235 156 198Z M265 37 308 30 325 56 299 88 278 76Z" />
          <path d="M353 95 380 69 416 76 441 52 496 45 540 55 590 46 669 67 723 96 695 128 645 120 620 151 585 156 563 181 540 178 512 151 485 169 464 143 431 138 409 118 384 135 358 119Z M363 148 410 137 450 166 456 211 433 258 411 290 389 264 378 223 351 191Z M615 256 658 244 698 268 711 297 678 313 631 299Z M731 314 748 304 742 339 723 349Z M464 258 476 242 479 279 468 294Z" />
        </g>
        <g fill="none" stroke="#8ba198" opacity=".25">
          {[90, 140, 190, 240, 290].map((y) => (
            <path key={y} d={`M0 ${y} Q400 ${y - 45} 800 ${y}`} />
          ))}
        </g>
      </svg>
      <div className="map-label">
        <span className="live-dot" /> TIERRA / MAPA ESQUEMÁTICO
      </div>
      {candidates.map((site, i) => (
        <button
          key={site.id}
          aria-label={`Seleccionar ${site.name}`}
          aria-pressed={selected === site.id}
          className={`map-pin ${selected === site.id ? "active" : ""}`}
          style={{
            left: `${((site.longitude + 180) / 360) * 100}%`,
            top: `${((90 - site.latitude) / 180) * 100}%`,
          }}
          onClick={() => onSelect(site.id)}
        >
          <span>{String(i + 1).padStart(2, "0")}</span>
          <b>{site.name}</b>
        </button>
      ))}
      <div className="map-legend">
        <span /> Candidato terrestre{" "}
        <small>Ubicaciones aproximadas · sin teselas satelitales</small>
      </div>
    </div>
  );
}
