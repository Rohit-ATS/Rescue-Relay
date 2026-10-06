// Generates an SVG card and renders a PNG (or clean SVG data URI) for image-required platforms like Instagram.

export interface CardOptions {
  title: string;
  category: string;
  pounds: number;
  meals: number;
  orgName: string;
  address: string;
  deadline: string;
  storage: string;
}

export function generateCardSvg(opts: CardOptions): string {
  const safeTitle = escapeXml(opts.title);
  const safeCategory = escapeXml(opts.category);
  const safeOrg = escapeXml(opts.orgName);
  const safeAddress = escapeXml(opts.address);
  const safeDeadline = escapeXml(opts.deadline);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#143126" />
      <stop offset="60%" stop-color="#1d4535" />
      <stop offset="100%" stop-color="#0e231b" />
    </linearGradient>
    <linearGradient id="cardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.08" />
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.03" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#000000" flood-opacity="0.45" />
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1080" height="1080" fill="url(#bg)" />

  <!-- Accent Circle -->
  <circle cx="980" cy="120" r="320" fill="#e07a5f" opacity="0.12" filter="blur(60px)" />
  <circle cx="120" cy="960" r="260" fill="#81b29a" opacity="0.15" filter="blur(50px)" />

  <!-- Header Banner -->
  <g transform="translate(80, 80)">
    <rect width="210" height="44" rx="22" fill="#e07a5f" opacity="0.25" />
    <text x="24" y="28" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="700" fill="#f4a261" letter-spacing="2">RESCUERELAY</text>
    <circle cx="178" cy="22" r="5" fill="#f4a261" />
  </g>

  <!-- Main Card Container -->
  <g transform="translate(80, 160)" filter="url(#shadow)">
    <rect width="920" height="820" rx="28" fill="url(#cardGrad)" stroke="#ffffff" stroke-opacity="0.15" stroke-width="2" />

    <!-- Badge -->
    <rect x="50" y="50" width="180" height="38" rx="8" fill="#e07a5f" />
    <text x="68" y="74" font-family="system-ui, -apple-system, sans-serif" font-size="15" font-weight="700" fill="#ffffff" letter-spacing="1">FRESH RESCUE</text>

    <!-- Title -->
    <text x="50" y="160" font-family="system-ui, -apple-system, sans-serif" font-size="44" font-weight="800" fill="#ffffff">
      ${safeTitle}
    </text>

    <!-- Category & Storage -->
    <text x="50" y="210" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="500" fill="#81b29a">
      ${safeCategory.toUpperCase()} · ${opts.storage.toUpperCase()}
    </text>

    <!-- Metrics Stat Box -->
    <g transform="translate(50, 270)">
      <rect width="820" height="190" rx="20" fill="#0b1b15" opacity="0.75" stroke="#ffffff" stroke-opacity="0.08" />

      <!-- Stat 1: Pounds -->
      <g transform="translate(60, 50)">
        <text x="0" y="65" font-family="system-ui, -apple-system, sans-serif" font-size="76" font-weight="900" fill="#ffffff">${opts.pounds.toLocaleString()}</text>
        <text x="0" y="105" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="600" fill="#a8dadc" letter-spacing="1">POUNDS RESCUED</text>
      </g>

      <!-- Stat 2: Estimated Meals -->
      <g transform="translate(480, 50)">
        <text x="0" y="65" font-family="system-ui, -apple-system, sans-serif" font-size="76" font-weight="900" fill="#f4a261">${opts.meals.toLocaleString()}</text>
        <text x="0" y="105" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="600" fill="#a8dadc" letter-spacing="1">ESTIMATED MEALS</text>
      </g>
    </g>

    <!-- Details Section -->
    <g transform="translate(50, 520)">
      <text x="0" y="30" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="700" fill="#81b29a" letter-spacing="1">DISTRIBUTION PARTNER</text>
      <text x="0" y="70" font-family="system-ui, -apple-system, sans-serif" font-size="32" font-weight="700" fill="#ffffff">${safeOrg}</text>
      <text x="0" y="110" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="400" fill="#e0e1dd">${safeAddress}</text>

      <line x1="0" y1="140" x2="820" y2="140" stroke="#ffffff" stroke-opacity="0.1" stroke-width="1" />

      <text x="0" y="185" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="700" fill="#81b29a" letter-spacing="1">PICKUP WINDOW</text>
      <text x="0" y="225" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="600" fill="#f4a261">Open until ${safeDeadline}</text>
    </g>
  </g>

  <!-- Footer Tagline -->
  <text x="540" y="1030" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="500" fill="#ffffff" opacity="0.6">
    From surplus to supper — rescue food before it spoils · RescueRelay Network
  </text>
</svg>`;
}

function escapeXml(unsafe: string): string {
  return (unsafe || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
