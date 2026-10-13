import type { JSX } from 'preact'
import type { PrimType } from '../core/doc/model'
import { DEFAULT_COLORS } from '../core/doc/shapes'
import { boreOutline, gearOutline } from '../core/doc/gear'

type P = { size?: number }

const Svg = ({ size = 20, children }: P & { children: JSX.Element | JSX.Element[] }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const Icon = {
  new: (p: P) => (
    <Svg {...p}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M12 11v6M9 14h6" />
    </Svg>
  ),
  open: (p: P) => (
    <Svg {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1" />
      <path d="M3 7v11a1 1 0 0 0 1 1h14l3-8H6l-3 8" />
    </Svg>
  ),
  save: (p: P) => (
    <Svg {...p}>
      <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M7 3v5h8V3M7 21v-7h10v7" />
    </Svg>
  ),
  import: (p: P) => (
    <Svg {...p}>
      <path d="M12 3v11M7 9l5 5 5-5" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </Svg>
  ),
  export: (p: P) => (
    <Svg {...p}>
      <path d="M12 15V4M7 9l5-5 5 5" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </Svg>
  ),
  undo: (p: P) => (
    <Svg {...p}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </Svg>
  ),
  redo: (p: P) => (
    <Svg {...p}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h3" />
    </Svg>
  ),
  copy: (p: P) => (
    <Svg {...p}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </Svg>
  ),
  paste: (p: P) => (
    <Svg {...p}>
      <path d="M9 4h6v3H9z" />
      <path d="M15 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
    </Svg>
  ),
  duplicate: (p: P) => (
    <Svg {...p}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M14 11v6M11 14h6M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </Svg>
  ),
  trash: (p: P) => (
    <Svg {...p}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3" />
    </Svg>
  ),
  group: (p: P) => (
    <Svg {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2.5" />
      <rect x="7" y="7" width="6" height="6" rx="1" />
      <circle cx="15" cy="15" r="3" />
    </Svg>
  ),
  ungroup: (p: P) => (
    <Svg {...p}>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <circle cx="17" cy="17" r="4" />
      <path d="M14 5h5v5M5 14v5h5" stroke-dasharray="2 2" />
    </Svg>
  ),
  align: (p: P) => (
    <Svg {...p}>
      <path d="M4 3v18" />
      <rect x="7" y="5" width="12" height="5" rx="1" />
      <rect x="7" y="14" width="7" height="5" rx="1" />
    </Svg>
  ),
  mirror: (p: P) => (
    <Svg {...p}>
      <path d="M12 3v18" stroke-dasharray="2 2.5" />
      <path d="M9 7 3 17h6zM15 7l6 10h-6z" />
    </Svg>
  ),
  home: (p: P) => (
    <Svg {...p}>
      <path d="m3 11 9-7 9 7" />
      <path d="M5 10v10h14V10" />
    </Svg>
  ),
  fit: (p: P) => (
    <Svg {...p}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </Svg>
  ),
  plus: (p: P) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  minus: (p: P) => (
    <Svg {...p}>
      <path d="M5 12h14" />
    </Svg>
  ),
  drop: (p: P) => (
    <Svg {...p}>
      <rect x="8" y="3" width="8" height="8" rx="1" />
      <path d="M12 13v5M9 16l3 3 3-3M3 21h18" />
    </Svg>
  ),
  globe: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </Svg>
  ),
  help: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" />
    </Svg>
  ),
  chevron: (p: P) => (
    <Svg {...p}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  ),
  close: (p: P) => (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  ),
  workplane: (p: P) => (
    <Svg {...p}>
      <path d="M3 15 12 10l9 5-9 5z" />
      <path d="M12 10V3M9.5 5.5 12 3l2.5 2.5" />
    </Svg>
  ),
  ruler: (p: P) => (
    <Svg {...p}>
      <path d="M4 20V4h4v12h12v4z" />
      <path d="M8 8H6M8 12H6M12 16v2M16 16v2" />
    </Svg>
  ),
  brush: (p: P) => (
    <Svg {...p}>
      <path d="M20 4l-9 9" />
      <path d="M14.5 6.5l3 3" />
      <path d="M10 12c-2.5 0-4 1.6-4 4 0 1.6-1 2.6-3 3 3 1.5 8 1 9.5-1.7.8-1.5.2-3.6-2.5-5.3z" />
    </Svg>
  ),
  eraser: (p: P) => (
    <Svg {...p}>
      <path d="M15 4l5 5-9.5 9.5H6L3.5 16a1.4 1.4 0 0 1 0-2z" />
      <path d="M9.5 9.5l5 5" />
      <path d="M11 18.5h9" />
    </Svg>
  ),
  palette: (p: P) => (
    <Svg {...p}>
      <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.3-1.7-.3-.9.2-1.8 1.2-1.8H17a4 4 0 0 0 4-4c0-5-4-10.5-9-10.5z" />
      <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
      <circle cx="10" cy="7" r="1.2" fill="currentColor" />
      <circle cx="14.5" cy="7" r="1.2" fill="currentColor" />
      <circle cx="17" cy="11" r="1.2" fill="currentColor" />
    </Svg>
  ),
  hole: (p: P) => (
    <Svg {...p}>
      <rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2.5" />
      <path d="M8 12l4-4M8 16l8-8M12 16l4-4" />
    </Svg>
  ),
  shapes: (p: P) => (
    <Svg {...p}>
      <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </Svg>
  ),
  sketch: (p: P) => (
    <Svg {...p}>
      <path d="M3 21h18" stroke-dasharray="2 2.5" />
      <path d="M5 17 15.5 6.5l3 3L8 20H5z" />
      <path d="M13.5 8.5l3 3" />
    </Svg>
  ),
  robot: (p: P) => (
    <Svg {...p}>
      <rect x="5" y="8" width="14" height="10" rx="2" />
      <path d="M12 8V4M10 4h4M3 11v4M21 11v4" />
      <circle cx="9.5" cy="13" r="1.3" fill="currentColor" />
      <circle cx="14.5" cy="13" r="1.3" fill="currentColor" />
    </Svg>
  ),
  /** a shape travels to the robotics field */
  toSim: (p: P) => (
    <Svg {...p}>
      <path d="M2.5 9.5 6 7.5l3.5 2v4L6 15.5l-3.5-2z M2.5 9.5 6 11.5l3.5-2M6 11.5v4" />
      <path d="M11 11.5h4.5M13.5 9l2.5 2.5-2.5 2.5" />
      <rect x="17" y="8" width="5.5" height="7" rx="1.2" />
      <path d="M19.75 8V5.5" />
      <circle cx="19.75" cy="11.3" r="0.9" fill="currentColor" />
    </Svg>
  ),
  circuit: (p: P) => (
    <Svg {...p}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
      <path d="M9 6V3M12 6V3M15 6V3M9 21v-3M12 21v-3M15 21v-3M6 9H3M6 15H3M21 9h-3M21 15h-3" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </Svg>
  ),
  more: (p: P) => (
    <Svg {...p}>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" />
    </Svg>
  ),
  camera: (p: P) => (
    <Svg {...p}>
      <path d="M4 8h3l1.6-2.4h6.8L17 8h3v11H4z" />
      <circle cx="12" cy="13.2" r="3.4" />
    </Svg>
  ),
  video: (p: P) => (
    <Svg {...p}>
      <rect x="3.5" y="6.5" width="12" height="11" rx="1.5" />
      <path d="M15.5 10.5l5-3v9l-5-3z" />
    </Svg>
  ),
  target: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </Svg>
  ),
  play: (p: P) => (
    <Svg {...p}>
      <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
    </Svg>
  ),
  pause: (p: P) => (
    <Svg {...p}>
      <path d="M8 5v14M16 5v14" stroke-width="3.2" />
    </Svg>
  ),
  stop: (p: P) => (
    <Svg {...p}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
    </Svg>
  ),
  flag: (p: P) => (
    <Svg {...p}>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </Svg>
  ),
  skSelect: (p: P) => (
    <Svg {...p}>
      <path d="M6 3l12 8.5-5.2 1.2L16 19l-2.4 1.2-3.2-6.3L6 17.5z" />
    </Svg>
  ),
  skLine: (p: P) => (
    <Svg {...p}>
      <path d="M4 18 11 8l5 5 4-8" />
      <circle cx="4" cy="18" r="1.6" fill="currentColor" />
      <circle cx="11" cy="8" r="1.6" fill="currentColor" />
      <circle cx="16" cy="13" r="1.6" fill="currentColor" />
      <circle cx="20" cy="5" r="1.6" fill="currentColor" />
    </Svg>
  ),
  skRect: (p: P) => (
    <Svg {...p}>
      <rect x="4" y="6" width="16" height="12" />
      <circle cx="4" cy="6" r="1.6" fill="currentColor" />
      <circle cx="20" cy="18" r="1.6" fill="currentColor" />
    </Svg>
  ),
  skRectCenter: (p: P) => (
    <Svg {...p}>
      <rect x="4" y="6" width="16" height="12" />
      <path d="M12 12 20 18" stroke-dasharray="2 2" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </Svg>
  ),
  skCircle: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 12h8" stroke-dasharray="2 2" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </Svg>
  ),
  skArc: (p: P) => (
    <Svg {...p}>
      <path d="M20 12a8 8 0 0 0-14.9-4" />
      <path d="M12 12h8M12 12 5.1 8" stroke-dasharray="2 2" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </Svg>
  ),
  skSpline: (p: P) => (
    <Svg {...p}>
      <path d="M3 17c3-9 6-9 8-5s5 4 10-5" />
      <circle cx="3" cy="17" r="1.6" fill="currentColor" />
      <circle cx="11" cy="12" r="1.6" fill="currentColor" />
      <circle cx="21" cy="7" r="1.6" fill="currentColor" />
    </Svg>
  ),
  skArc3: (p: P) => (
    <Svg {...p}>
      <path d="M4 17a9 9 0 0 1 16 0" />
      <circle cx="4" cy="17" r="1.6" fill="currentColor" />
      <circle cx="12" cy="9" r="1.6" fill="currentColor" />
      <circle cx="20" cy="17" r="1.6" fill="currentColor" />
    </Svg>
  ),
  skPolygon: (p: P) => (
    <Svg {...p}>
      <path d="M12 3.5 19.4 7.8v8.4L12 20.5l-7.4-4.3V7.8z" />
    </Svg>
  ),
  skPoint: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <path d="M12 4v3M12 17v3M4 12h3M17 12h3" />
    </Svg>
  ),
  skTrim: (p: P) => (
    <Svg {...p}>
      <path d="M4 12h5M15 12h5" />
      <path d="M9 12h6" stroke-dasharray="1.5 2" />
      <path d="M9 5v14M15 5v14" stroke-width="1.3" />
      <path d="M10.5 8.5 13.5 5.5M13.5 8.5 10.5 5.5" stroke-width="1.5" />
    </Svg>
  ),
  skFillet: (p: P) => (
    <Svg {...p}>
      <path d="M4 20V13a8 8 0 0 1 8-8h8" />
      <path d="M4 5v4M4 5h4" stroke-dasharray="1.5 2" stroke-width="1.3" />
    </Svg>
  ),
  construction: (p: P) => (
    <Svg {...p}>
      <path d="M4 20 20 4" stroke-dasharray="3 2.5" />
      <circle cx="12" cy="12" r="6" stroke-dasharray="3 2.5" />
    </Svg>
  ),
  check: (p: P) => (
    <Svg {...p}>
      <path d="M5 12.5 10 17.5 19 7" />
    </Svg>
  )
}

/** Small isometric drawings for the shapes panel. */
export function ShapeIcon({ type, size = 56 }: { type: PrimType; size?: number }) {
  const c = DEFAULT_COLORS[type]
  const dark = shade(c, -0.22)
  const light = shade(c, 0.18)
  const s = { stroke: shade(c, -0.4), 'stroke-width': 1, 'stroke-linejoin': 'round' as const }
  let body: JSX.Element
  switch (type) {
    case 'box':
      body = (
        <g {...s}>
          <path d="M32 10 52 20 32 30 12 20z" fill={light} />
          <path d="M12 20v22l20 10V30z" fill={c} />
          <path d="M52 20v22L32 52V30z" fill={dark} />
        </g>
      )
      break
    case 'cylinder':
      body = (
        <g {...s}>
          <path d="M14 18v26c0 5 8 9 18 9s18-4 18-9V18" fill={c} />
          <path d="M32 44c10 0 18-4 18-9" fill="none" stroke="none" />
          <ellipse cx="32" cy="18" rx="18" ry="8" fill={light} />
        </g>
      )
      break
    case 'sphere':
      body = (
        <g {...s}>
          <circle cx="32" cy="32" r="21" fill={c} />
          <ellipse cx="25" cy="24" rx="8" ry="6" fill={light} stroke="none" opacity="0.8" />
        </g>
      )
      break
    case 'cone':
      body = (
        <g {...s}>
          <path d="M32 8 50 44c0 5-8 8-18 8s-18-3-18-8z" fill={c} />
          <path d="M32 8 50 44c0 5-8 8-18 8" fill={dark} stroke="none" opacity="0.35" />
        </g>
      )
      break
    case 'pyramid':
      body = (
        <g {...s}>
          <path d="M32 8 12 40l20 12z" fill={c} />
          <path d="M32 8 52 40 32 52z" fill={dark} />
        </g>
      )
      break
    case 'wedge':
      body = (
        <g {...s}>
          <path d="M14 14v28l20 10V34z" fill={c} />
          <path d="M14 14 54 34 34 34z" fill={light} />
          <path d="M34 34h20L34 52z" fill={dark} />
        </g>
      )
      break
    case 'hemisphere':
      body = (
        <g {...s}>
          <path d="M11 38a21 21 0 0 1 42 0c0 5-9.4 9-21 9s-21-4-21-9z" fill={c} />
          <ellipse cx="32" cy="38" rx="21" ry="9" fill={dark} />
          <ellipse cx="25" cy="25" rx="7" ry="4.5" fill={light} stroke="none" opacity="0.8" />
        </g>
      )
      break
    case 'roundRoof':
      body = (
        <g {...s}>
          <path d="M8 42 30 52V40a12 12 0 0 0-22 2z" fill={dark} />
          <path d="M8 42a12 12 0 0 1 22-2l26-12a12 12 0 0 0-22 2z" fill={c} />
          <path d="M30 40v12l26-12V28z" fill={dark} opacity="0.55" />
        </g>
      )
      break
    case 'polygon':
      body = (
        <g {...s}>
          <path d="M14 24v18l9 6h18l9-6V24l-9 6H23z" fill={dark} />
          <path d="M23 30h18v18H23z" fill={c} />
          <path d="M14 24l9-7h18l9 7-9 6H23z" fill={light} />
        </g>
      )
      break
    case 'icosahedron':
      body = (
        <g {...s}>
          <path d="M32 8 52 20v24L32 56 12 44V20z" fill={c} />
          <path d="M32 8 44 26H20z" fill={light} />
          <path d="M20 26h24L32 46z" fill={c} />
          <path d="M44 26 52 20v24L32 46z" fill={dark} />
          <path d="M12 20 20 26 32 46 12 44z" fill={light} opacity="0.7" />
          <path d="M32 46 52 44 32 56 12 44z" fill={dark} opacity="0.8" />
        </g>
      )
      break
    case 'torus':
      body = (
        <g {...s}>
          <ellipse cx="32" cy="34" rx="22" ry="13" fill={c} />
          <ellipse cx="32" cy="32" rx="9" ry="4.5" style={{ fill: 'var(--panel-2)' }} />
          <path d="M23 33c3 2 15 2 18 0" fill="none" stroke={dark} />
        </g>
      )
      break
    case 'text':
      body = (
        <g>
          <text
            x="32"
            y="44"
            text-anchor="middle"
            font-family="Arial, sans-serif"
            font-weight="700"
            font-size="30"
            fill={c}
            stroke={dark}
            stroke-width="1"
          >
            Aa
          </text>
        </g>
      )
      break
    case 'gear':
      body = (
        <g {...s}>
          <path d={GEAR_ICON} transform="translate(32 34) scale(1 0.8)" fill={dark} />
          <path d={GEAR_ICON} transform="translate(32 30) scale(1 0.8)" fill={c} fill-rule="evenodd" />
        </g>
      )
      break
    case 'bolt':
      body = (
        <g {...s}>
          <path d="M26 20h12v32a6 3 0 0 1-12 0z" fill={c} />
          <path d="M26 26l12-3M26 31l12-3M26 36l12-3M26 41l12-3M26 46l12-3" stroke={dark} fill="none" />
          <path d="M18 12l7-4h14l7 4v7l-7 4H25l-7-4z" fill={dark} />
          <path d="M18 12l7-4h14l7 4-7 4H25z" fill={light} />
        </g>
      )
      break
    case 'nut':
      body = (
        <g {...s}>
          <path d="M12 28l10-8h20l10 8v10l-10 8H22l-10-8z" fill={dark} />
          <path d="M12 28l10-8h20l10 8-10 8H22z" fill={c} />
          <ellipse cx="32" cy="28" rx="8" ry="4.5" style={{ fill: 'var(--panel-2)' }} />
        </g>
      )
      break
    case 'jar':
      body = (
        <g {...s}>
          <path d="M14 24v24c0 4 8 7 18 7s18-3 18-7V24" fill={c} />
          <path d="M14 18v7c0 4 8 7 18 7s18-3 18-7v-7" fill={dark} />
          <ellipse cx="32" cy="18" rx="18" ry="6" fill={light} />
        </g>
      )
      break
    case 'rack':
      body = (
        <g {...s}>
          <path d="M8 40l40-14 8 4-40 14z" fill={light} />
          <path d="M8 40v6l8 4v-6zM16 44v6l40-14v-6z" fill={dark} />
          <path d="M10 37l4-6 4 4 4-6 4 4 4-6 4 4 4-6 4 4 4-6 4 4 2-1 4 2-40 14-8-4z" fill={c} />
        </g>
      )
      break
    case 'wheel':
      body = (
        <g {...s}>
          <ellipse cx="34" cy="34" rx="16" ry="20" fill={dark} />
          <ellipse cx="30" cy="32" rx="16" ry="20" fill={c} />
          <ellipse cx="30" cy="32" rx="10" ry="13" fill={light} />
          <circle cx="30" cy="32" r="3" style={{ fill: 'var(--panel-2)' }} />
        </g>
      )
      break
    case 'pulley':
      body = (
        <g {...s}>
          <ellipse cx="32" cy="42" rx="20" ry="8" fill={dark} />
          <path d="M18 34h28v6H18z" fill={dark} />
          <ellipse cx="32" cy="34" rx="14" ry="5.5" fill={c} />
          <ellipse cx="32" cy="26" rx="20" ry="8" fill={c} />
          <ellipse cx="32" cy="26" rx="4" ry="2" style={{ fill: 'var(--panel-2)' }} />
        </g>
      )
      break
    case 'washer':
      body = (
        <g {...s}>
          <path d="M10 30v6c0 6 10 11 22 11s22-5 22-11v-6" fill={dark} />
          <ellipse cx="32" cy="30" rx="22" ry="11" fill={c} />
          <ellipse cx="32" cy="30" rx="9" ry="4.5" style={{ fill: 'var(--panel-2)' }} />
        </g>
      )
      break
    case 'spring':
      body = (
        <g fill="none" stroke-linecap="round">
          <path d="M18 52c0-4 28-2 28-6s-28-2-28-6 28-2 28-6-28-2-28-6 28-2 28-6-28-2-28-6 28-2 28-6" stroke={dark} stroke-width="5" />
          <path d="M18 52c0-4 28-2 28-6s-28-2-28-6 28-2 28-6-28-2-28-6 28-2 28-6-28-2-28-6 28-2 28-6" stroke={c} stroke-width="3" />
        </g>
      )
      break
    case 'boxLid':
      body = (
        <g {...s}>
          <path d="M10 30l22 10 22-10v14L32 54 10 44z" fill={c} />
          <path d="M32 40v14l22-10V30z" fill={dark} />
          <path d="M10 20l22-10 22 10-22 10z" fill={light} />
          <path d="M10 20v3l22 10 22-10v-3l-22 10z" fill={dark} />
        </g>
      )
      break
    case 'hinge':
      body = (
        <g {...s}>
          <path d="M6 38l20-10v8L6 46z" fill={c} />
          <path d="M38 28l20 10v8l-20-10z" fill={dark} />
          <path d="M26 24h12v14H26z" fill={light} />
          <path d="M26 28h12M26 33h12" stroke={dark} fill="none" />
        </g>
      )
      break
    case 'knob':
      body = (
        <g {...s}>
          <path d="M32 14l6 6 8-1 0 8 6 5-6 5v8l-8-1-6 6-6-6-8 1v-8l-6-5 6-5v-8l8 1z" fill={dark} transform="translate(0 4)" />
          <path d="M32 14l6 6 8-1 0 8 6 5-6 5v8l-8-1-6 6-6-6-8 1v-8l-6-5 6-5v-8l8 1z" fill={c} />
          <circle cx="32" cy="32" r="5" style={{ fill: 'var(--panel-2)' }} />
        </g>
      )
      break
    case 'tag':
      body = (
        <g {...s}>
          <rect x="6" y="20" width="52" height="24" rx="6" fill={dark} transform="translate(0 3)" />
          <rect x="6" y="20" width="52" height="24" rx="6" fill={c} />
          <circle cx="14" cy="32" r="3.5" style={{ fill: 'var(--panel-2)' }} />
          <text x="37" y="37" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="14" fill={dark} stroke="none">
            Ab
          </text>
        </g>
      )
      break
    default:
      body = <path d="M12 44 32 10l20 34z" fill={c} {...s} />
  }
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      {body}
    </svg>
  )
}

/** A 12-tooth gear with a hole, seen from above: the outline for the shape tile. */
const GEAR_ICON = (() => {
  const g = { teeth: 12, module: 3.9, thickness: 1, bore: 13 }
  const path = (pts: [number, number][]) => 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z'
  return path(gearOutline(g, 3)) + path(boreOutline(g, 20))
})()

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.round(Math.max(0, Math.min(255, amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)))
  )
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** Small pictures for sketch constraints (panel buttons and the badges next to geometry). */
export function ConstraintGlyph({ type, size = 16 }: { type: string; size?: number }) {
  let body: JSX.Element
  switch (type) {
    case 'coincident':
      body = (
        <>
          <path d="M3 21 12 12M21 3l-9 9" />
          <circle cx="12" cy="12" r="3.2" fill="currentColor" />
        </>
      )
      break
    case 'pointOn':
      body = (
        <>
          <path d="M3 18 21 8" />
          <circle cx="9" cy="14.7" r="3" fill="currentColor" />
        </>
      )
      break
    case 'horizontal':
      body = (
        <>
          <path d="M4 12h16" />
          <path d="M4 8v8M20 8v8" stroke-width="1.4" />
        </>
      )
      break
    case 'vertical':
      body = (
        <>
          <path d="M12 4v16" />
          <path d="M8 4h8M8 20h8" stroke-width="1.4" />
        </>
      )
      break
    case 'parallel':
      body = <path d="M5 19 14 4M10 20l9-15" />
      break
    case 'perpendicular':
      body = <path d="M4 20h16M12 20V4" />
      break
    case 'equal':
      body = <path d="M5 9h14M5 15h14" />
      break
    case 'regular':
      body = (
        <>
          <circle cx="12" cy="12" r="9.5" stroke-width="1.2" stroke-dasharray="2.2 2" />
          <path d="M12 5.2 17.9 8.6v6.8L12 18.8l-5.9-3.4V8.6z" />
        </>
      )
      break
    case 'tangent':
      body = (
        <>
          <circle cx="12" cy="14" r="6" />
          <path d="M3 8h18" />
        </>
      )
      break
    case 'midpoint':
      body = (
        <>
          <path d="M3 17 21 7" />
          <path d="M8 18l-2-4M18 12l-2-4" stroke-width="1.3" />
          <circle cx="12" cy="12" r="2.6" fill="currentColor" />
        </>
      )
      break
    case 'symmetric':
      body = (
        <>
          <path d="M12 3v18" stroke-dasharray="2.5 2" />
          <circle cx="6" cy="12" r="2.6" fill="currentColor" />
          <circle cx="18" cy="12" r="2.6" fill="currentColor" />
        </>
      )
      break
    case 'lock':
      body = (
        <>
          <rect x="5" y="11" width="14" height="10" rx="1.5" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </>
      )
      break
    case 'dimension':
    case 'distance':
      body = (
        <>
          <path d="M3 6v12M21 6v12" stroke-width="1.4" />
          <path d="M5 12h14M8 9l-3 3 3 3M16 9l3 3-3 3" />
        </>
      )
      break
    case 'distanceX':
      body = (
        <>
          <path d="M3 10v10M21 10v10" stroke-width="1.4" />
          <path d="M5 15h14M8 12l-3 3 3 3M16 12l3 3-3 3" />
          <path d="M9.5 3.5l5 5M14.5 3.5l-5 5" stroke-width="1.5" />
        </>
      )
      break
    case 'distanceY':
      body = (
        <>
          <path d="M10 3h10M10 21h10" stroke-width="1.4" />
          <path d="M15 5v14M12 8l3-3 3 3M12 16l3 3 3-3" />
          <path d="M3 9l2.5 3L8 9M5.5 12v4" stroke-width="1.5" />
        </>
      )
      break
    default:
      body = <circle cx="12" cy="12" r="4" />
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {body}
    </svg>
  )
}
