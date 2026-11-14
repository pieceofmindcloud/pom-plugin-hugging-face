/*
 * The POM's loading puzzle (`MissingPiece` variant "loading" in the POM
 * frontend), redrawn with plain SVG and CSS: the host kit does not expose it
 * and the plugin does not bundle framer-motion. Three pieces fly in and lock
 * together; the fourth hovers over its slot while the work is on its way.
 */
import type { CSSProperties } from "react";

/** -1 a blank (hole), 0 a straight border, 1 a tab sticking out. */
type Edge = -1 | 0 | 1;

interface Piece {
  col: number;
  row: number;
  /** Clockwise: top, right, bottom, left. */
  edges: [Edge, Edge, Edge, Edge];
  from: { x: number; y: number; rotate: number };
  color: string;
}

const CELL = 64;
const PAD = 22;
const SIZE = CELL * 2 + PAD * 2;

const PIECES: Piece[] = [
  { col: 0, row: 0, edges: [0, 1, -1, 0], from: { x: -1.6, y: -1.2, rotate: -28 }, color: "#4f9bff" },
  { col: 1, row: 0, edges: [0, 0, 1, -1], from: { x: 1.7, y: -1.1, rotate: 24 }, color: "#35c9f0" },
  { col: 0, row: 1, edges: [1, -1, 0, 0], from: { x: -1.5, y: 1.4, rotate: 18 }, color: "#2fdcc8" },
];
const MISSING: Pick<Piece, "col" | "row" | "edges"> = { col: 1, row: 1, edges: [-1, 0, 0, 1] };

function piecePath(piece: Pick<Piece, "col" | "row" | "edges">): string {
  const x = PAD + piece.col * CELL;
  const y = PAD + piece.row * CELL;
  const corners: [number, number][] = [[x, y], [x + CELL, y], [x + CELL, y + CELL], [x, y + CELL]];
  let path = `M${x} ${y}`;
  for (let side = 0; side < 4; side += 1) {
    const [x0, y0] = corners[side];
    const [x1, y1] = corners[(side + 1) % 4];
    const dx = (x1 - x0) / CELL;
    const dy = (y1 - y0) / CELL;
    const nx = dy;
    const ny = -dx;
    const h = piece.edges[side] * 0.24;
    const at = (t: number, height: number) =>
      `${(x0 + dx * CELL * t + nx * CELL * height).toFixed(1)} ${(y0 + dy * CELL * t + ny * CELL * height).toFixed(1)}`;
    if (h === 0) {
      path += ` L${at(1, 0)}`;
      continue;
    }
    path += ` L${at(0.38, 0)}`;
    path += ` C${at(0.32, h * 0.55)} ${at(0.3, h)} ${at(0.5, h)}`;
    path += ` C${at(0.7, h)} ${at(0.68, h * 0.55)} ${at(0.62, 0)}`;
    path += ` L${at(1, 0)}`;
  }
  return `${path} Z`;
}

export function PieceLoading({ label, size = 0.7 }: { label: string; size?: number }) {
  const px = Math.round(SIZE * size);
  return (
    <div className="pb-piece-loading" role="status" aria-live="polite">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={px} height={px} className="pb-piece-svg" aria-hidden="true">
        <path className="pb-piece-slot" d={piecePath(MISSING)} />
        <path className="pb-piece-hover" d={piecePath(MISSING)} />
        {PIECES.map((piece, index) => (
          <path
            key={`${piece.col}-${piece.row}`}
            className="pb-piece"
            d={piecePath(piece)}
            fill={piece.color}
            style={{
              "--pb-from-x": `${piece.from.x * CELL}px`,
              "--pb-from-y": `${piece.from.y * CELL}px`,
              "--pb-from-r": `${piece.from.rotate}deg`,
              animationDelay: `${0.1 + index * 0.18}s`,
            } as CSSProperties}
          />
        ))}
      </svg>
      <span className="pb-piece-label">{label}</span>
    </div>
  );
}
