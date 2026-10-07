import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/** Adds `sketch-in` once the element scrolls into view, which starts its draw/reveal animations. */
export function useSketchIn<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { el.classList.add("sketch-in"); return; }
    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { el.classList.add("sketch-in"); io.disconnect(); }
    }, { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useSketchIn<HTMLDivElement>();
  return <div ref={ref} className={`reveal ${className}`} style={{ "--delay": `${delay}s` } as CSSProperties}>{children}</div>;
}

/** One shared SVG filter that roughens every stroke so it reads as graphite on paper. */
export function PencilDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" className="absolute">
      <filter id="pencil" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" />
      </filter>
    </svg>
  );
}

const d = (len: number, delay = 0, dur = 1.6) => ({ "--len": len, "--delay": `${delay}s`, "--dur": `${dur}s` }) as CSSProperties;

/** A scribbled double underline that draws itself under a word. */
export function SketchUnderline({ className = "", auto = false, delay = 0.4 }: { className?: string; auto?: boolean; delay?: number }) {
  const a = auto ? "sketch-auto" : "";
  return (
    <svg viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true" className={`pointer-events-none absolute -bottom-3 left-0 h-4 w-full ${className}`}>
      <path className={`sketch-stroke sketch-draw ${a}`} strokeWidth="3.5" style={d(320, delay, 1)} d="M4 15 C 60 6, 140 6, 296 11" />
      <path className={`sketch-stroke sketch-draw ${a}`} strokeWidth="2" style={d(320, delay + 0.5, 0.9)} d="M18 20 C 90 13, 190 14, 286 17" />
    </svg>
  );
}

/** A loose hand-drawn loop around inline content. */
export function SketchCircle({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useSketchIn<HTMLSpanElement>();
  return (
    <span ref={ref} className="relative inline-block px-2">
      {children}
      <svg viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true" className={`pointer-events-none absolute -inset-x-2 -inset-y-3 h-[calc(100%+1.5rem)] w-[calc(100%+1rem)] ${className}`}>
        <path className="sketch-stroke sketch-draw" strokeWidth="2.5" style={d(600, 0.3, 1.4)} d="M30 14 C 90 -2, 190 6, 192 38 C 194 70, 60 80, 14 58 C -6 44, 12 20, 60 10" />
      </svg>
    </span>
  );
}

/** Curly arrow pointing down-right, used to link a heading to its content. */
export function SketchArrow({ className = "" }: { className?: string }) {
  const ref = useSketchIn<HTMLSpanElement>();
  return (
    <span ref={ref} className={`pointer-events-none inline-block ${className}`} aria-hidden="true">
      <svg viewBox="0 0 120 90" className="size-full">
        <path className="sketch-stroke sketch-draw" strokeWidth="2.5" style={d(220, 0.2, 1.2)} d="M8 10 C 30 60, 60 20, 70 50 S 90 80, 108 70" />
        <path className="sketch-stroke sketch-draw" strokeWidth="2.5" style={d(60, 1.3, 0.4)} d="M94 60 L 109 70 L 96 82" />
      </svg>
    </span>
  );
}

/** The relay itself: shop → truck → pantry along a dashed hand-drawn road with a moving delivery dot. */
export function SketchRelay({ className = "" }: { className?: string }) {
  const ref = useSketchIn<HTMLDivElement>();
  const road = "M60 150 C 160 60, 260 210, 380 130 S 560 70, 640 140";
  return (
    <div ref={ref} className={className} aria-hidden="true">
      <svg viewBox="0 0 700 220" className="size-full overflow-visible">
        {/* road */}
        <path className="sketch-stroke sketch-draw" strokeWidth="2" strokeDasharray="8 10" style={{ ...d(900, 0.2, 2.4), opacity: 0.55 }} d={road} />
        <path className="sketch-stroke sketch-draw" strokeWidth="2.6" style={d(900, 0.2, 2.4)} d={road} />
        {/* shop (donor) */}
        <g transform="translate(20 80)">
          <path className="sketch-stroke sketch-draw" strokeWidth="2.4" style={d(400, 0.6)} d="M4 70 L4 26 L76 26 L76 70 Z M0 26 L10 4 L70 4 L80 26 M30 70 L30 46 L50 46 L50 70" />
          <path className="sketch-stroke sketch-draw" strokeWidth="1.6" style={d(200, 1.2)} d="M10 26 q6 10 12 0 q6 10 12 0 q6 10 12 0 q6 10 12 0 q6 10 12 0" />
        </g>
        {/* truck */}
        <g transform="translate(300 60)">
          <path className="sketch-stroke sketch-draw" strokeWidth="2.4" style={d(420, 1.0)} d="M4 50 L4 12 L64 12 L64 50 Z M64 24 L88 24 L100 40 L100 50 L64 50" />
          <circle className="sketch-stroke sketch-draw" strokeWidth="2.4" style={d(60, 1.6, 0.6)} cx="24" cy="56" r="9" />
          <circle className="sketch-stroke sketch-draw" strokeWidth="2.4" style={d(60, 1.7, 0.6)} cx="82" cy="56" r="9" />
          <path className="sketch-stroke sketch-draw" strokeWidth="1.6" style={d(80, 2.0, 0.6)} d="M-14 22 L-2 22 M-20 34 L-4 34 M-12 46 L-2 46" />
        </g>
        {/* pantry (recipient) with heart */}
        <g transform="translate(600 70)">
          <path className="sketch-stroke sketch-draw" strokeWidth="2.4" style={d(400, 1.4)} d="M4 84 L4 36 L44 6 L84 36 L84 84 Z M34 84 L34 58 L54 58 L54 84" />
          <path className="sketch-stroke sketch-draw text-signal" strokeWidth="2.4" style={d(120, 2.2, 0.8)} d="M44 44 c -6 -10 -20 -4 -14 6 l 14 12 l 14 -12 c 6 -10 -8 -16 -14 -6 z" />
        </g>
        {/* moving delivery */}
        <circle r="6" className="sketch-route-dot fill-signal" style={{ offsetPath: `path("${road}")` } as CSSProperties} />
        {/* labels */}
        <text x="22" y="190" className="font-hand fill-current text-[22px]">donor</text>
        <text x="320" y="160" className="font-hand fill-current text-[22px]">volunteer</text>
        <text x="610" y="190" className="font-hand fill-current text-[22px]">pantry</text>
      </svg>
    </div>
  );
}

/** Small doodles used as section decorations. */
export function SketchDoodle({ kind, className = "" }: { kind: "apple" | "leaf" | "star" | "bag"; className?: string }) {
  const ref = useSketchIn<HTMLSpanElement>();
  const paths: Record<typeof kind, string[]> = {
    apple: ["M40 22 C 20 10, 4 30, 10 54 C 16 76, 34 80, 40 72 C 46 80, 64 76, 70 54 C 76 30, 60 10, 40 22 Z", "M40 22 C 40 12, 44 6, 50 2", "M44 12 C 54 4, 64 8, 66 12 C 58 18, 50 16, 44 12"],
    leaf: ["M8 70 C 10 30, 40 6, 74 6 C 74 40, 50 70, 8 70 Z", "M8 70 C 30 50, 50 30, 66 14"],
    star: ["M40 4 L 49 30 L 76 30 L 54 46 L 62 74 L 40 57 L 18 74 L 26 46 L 4 30 L 31 30 Z"],
    bag: ["M12 26 L 68 26 L 62 76 L 18 76 Z", "M28 26 C 28 6, 52 6, 52 26", "M22 40 L 58 40"],
  };
  return (
    <span ref={ref} className={`pointer-events-none inline-block ${className}`} aria-hidden="true">
      <svg viewBox="0 0 80 80" className="size-full overflow-visible">
        {paths[kind].map((p, i) => <path key={i} className="sketch-stroke sketch-draw" strokeWidth="2.4" style={d(320, 0.2 + i * 0.4, 1.2)} d={p} />)}
      </svg>
    </span>
  );
}

