/**
 * A season-pass banner, drawn.
 *
 * Banners are wide and short — they run across the top of the career page —
 * so each is a scene rather than an emblem. They are drawn in SVG and CSS, not
 * shipped as images: they stay sharp at any window width, cost nothing to
 * load, and cannot go missing from an installed copy.
 */

import { cn } from '@/lib/utils';

export function BannerArt({ bannerKey, className }: { bannerKey: string; className?: string }) {
  return (
    <div aria-hidden className={cn('relative w-full overflow-hidden bg-void', className)}>
      {bannerKey === 'paddock' ? <Paddock /> : bannerKey === 'sarthe' ? <LongStraight /> : <Generic />}
    </div>
  );
}

/** Paddock: a row of garage bays under the pit-lane lights. */
function Paddock() {
  return (
    <>
      <div
        className="absolute inset-0"
        style={{
          background: [
            'radial-gradient(ellipse 60% 90% at 50% -20%, rgba(200,164,92,0.22), transparent 70%)',
            'repeating-linear-gradient(90deg, transparent 0 86px, #06080a 86px 92px)',
            'repeating-linear-gradient(0deg, rgba(233,237,241,0.045) 0 1px, transparent 1px 6px)',
            'linear-gradient(to bottom, #1c242d, #0f141a)',
          ].join(', '),
        }}
      />
      {/* The pit wall's painted line, and the speed-limit line beside it. */}
      <div className="absolute inset-x-0 bottom-3 h-px bg-white/25" />
      <div className="absolute inset-x-0 bottom-0 h-1.5 bg-[#c8a45c]" />
      <div
        className="absolute inset-x-0 bottom-1.5 h-1.5"
        style={{ background: 'repeating-linear-gradient(90deg, #0b0e12 0 14px, #c8a45c 14px 28px)', opacity: 0.55 }}
      />
    </>
  );
}

/** Long Straight: the Mulsanne at dusk, running to the horizon. */
function LongStraight() {
  return (
    <svg viewBox="0 0 400 80" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
      <defs>
        <linearGradient id="ls-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0c1a14" />
          <stop offset="0.55" stopColor="#1d2a1c" />
          <stop offset="1" stopColor="#0b0e12" />
        </linearGradient>
        <radialGradient id="ls-glow" cx="0.75" cy="0.55" r="0.35">
          <stop offset="0" stopColor="#c8a45c" stopOpacity="0.55" />
          <stop offset="1" stopColor="#c8a45c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="80" fill="url(#ls-sky)" />
      <rect width="400" height="80" fill="url(#ls-glow)" />
      {/* Tree lines either side, darker the nearer they are. */}
      <path d="M0 50 L20 44 L38 47 L60 41 L84 46 L110 40 L140 45 L170 41 L200 46 L240 43 L296 44 L240 52 L0 64 Z" fill="#10201a" />
      <path d="M304 44 L330 41 L352 45 L376 40 L400 43 L400 62 L304 46 Z" fill="#10201a" />
      {/* The road, converging on the vanishing point. */}
      <path d="M30 80 L298 44 L302 44 L280 80 Z" fill="#161c22" />
      <path d="M30 80 L298 44" stroke="#e9edf1" strokeOpacity="0.35" strokeWidth="0.8" />
      <path d="M280 80 L302 44" stroke="#e9edf1" strokeOpacity="0.35" strokeWidth="0.8" />
      <path d="M155 80 L300 44" stroke="#c8a45c" strokeOpacity="0.8" strokeWidth="1.1" strokeDasharray="7 6" />
    </svg>
  );
}

/** A banner this build does not have artwork for yet. */
function Generic() {
  return (
    <div
      className="absolute inset-0"
      style={{ background: 'linear-gradient(110deg, #12171e 0%, color-mix(in oklab, var(--accent) 22%, #12171e) 55%, #0b0e12 100%)' }}
    />
  );
}
