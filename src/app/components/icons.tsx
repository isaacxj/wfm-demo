/** Line glyphs, 1px strokes on a pixel grid. */

interface IconProps {
  size?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: `0 0 ${size} ${size}`,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1,
  shapeRendering: 'crispEdges' as const,
  'aria-hidden': true,
});

export function Caret({ size = 9 }: IconProps) {
  return (
    <svg {...base(size)} shapeRendering="geometricPrecision">
      <path d="M1.5 3 L4.5 6 L7.5 3" />
    </svg>
  );
}

export function StepLeft() {
  return (
    <svg {...base(10)} shapeRendering="geometricPrecision">
      <path d="M6.5 1.5 L3 5 L6.5 8.5" />
    </svg>
  );
}

export function StepRight() {
  return (
    <svg {...base(10)} shapeRendering="geometricPrecision">
      <path d="M3.5 1.5 L7 5 L3.5 8.5" />
    </svg>
  );
}

export function Lock() {
  return (
    <svg {...base(9)}>
      <rect x="1.5" y="4.5" width="6" height="4" />
      <path d="M2.5 4.5 V2.5 H6.5 V4.5" />
    </svg>
  );
}

export function Check() {
  return (
    <svg {...base(9)} strokeWidth={1.5} shapeRendering="geometricPrecision">
      <path d="M1.5 4.5 L3.7 6.7 L7.5 2.3" />
    </svg>
  );
}

export function Close() {
  return (
    <svg {...base(8)} shapeRendering="geometricPrecision">
      <path d="M1.5 1.5 L6.5 6.5 M6.5 1.5 L1.5 6.5" />
    </svg>
  );
}

export function Download() {
  return (
    <svg {...base(11)}>
      <path d="M5.5 1 V7.5 M3 5 L5.5 7.5 L8 5" shapeRendering="geometricPrecision" />
      <path d="M1.5 9.5 H9.5" />
    </svg>
  );
}

export function Mark() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden shapeRendering="crispEdges" fill="#FFFFFF">
      <rect x="1" y="7" width="2" height="4" />
      <rect x="5" y="4" width="2" height="7" />
      <rect x="9" y="1" width="2" height="10" />
    </svg>
  );
}

const railPaths: Record<string, string> = {
  plans: 'M1.5 1.5 H10.5 V10.5 H1.5 Z M1.5 4.5 H10.5 M4.5 4.5 V10.5',
  scenarios: 'M2 2 V10 M2 6 H6 L9 3 M6 6 L9 9',
  hiring: 'M6 1.5 V10.5 M1.5 6 H10.5',
  sites: 'M1.5 10.5 V4.5 L6 1.5 L10.5 4.5 V10.5 Z M4.5 10.5 V7 H7.5 V10.5',
  assumptions: 'M2 3 H10 M2 6 H10 M2 9 H7',
  imports: 'M6 1.5 V7.5 M3.5 5 L6 7.5 L8.5 5 M1.5 10.5 H10.5',
  audit: 'M6 1.5 A4.5 4.5 0 1 0 6.01 1.5 M6 3.5 V6 L8 7.5',
  events: 'M2.5 10.5 V1.5 H9.5 L8 4 L9.5 6.5 H2.5',
};

export function RailIcon({ name }: { name: keyof typeof railPaths | string }) {
  return (
    <svg {...base(12)} shapeRendering="geometricPrecision">
      <path d={railPaths[name] ?? ''} />
    </svg>
  );
}

export function CollapseRight() {
  return (
    <svg {...base(10)} shapeRendering="geometricPrecision">
      <path d="M2 1.5 L5.5 5 L2 8.5 M5.5 1.5 L9 5 L5.5 8.5" />
    </svg>
  );
}

export function ExpandLeft() {
  return (
    <svg {...base(10)} shapeRendering="geometricPrecision">
      <path d="M8 1.5 L4.5 5 L8 8.5 M4.5 1.5 L1 5 L4.5 8.5" />
    </svg>
  );
}
