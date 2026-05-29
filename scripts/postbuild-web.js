/**
 * postbuild-web.js
 * Runs after `npx expo export --platform web`.
 * 1. Copies public/ → dist/ (Expo doesn't do this automatically for SDK 55)
 * 2. Injects PWA meta tags into dist/index.html
 */

const fs   = require('fs');
const path = require('path');

// ── 1. Copy public/ → dist/ ─────────────────────────────────────────────────
const publicDir = path.join(__dirname, '../public');
const distDir   = path.join(__dirname, '../dist');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      console.log(`  copied: ${entry.name}`);
    }
  }
}

if (fs.existsSync(publicDir)) {
  console.log('Copying public/ → dist/');
  copyDir(publicDir, distDir);
} else {
  console.warn('Warning: public/ folder not found, skipping copy');
}

// ── 2. Inject PWA meta tags into dist/index.html ────────────────────────────
const htmlPath = path.join(distDir, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const pwaTags = `
    <!-- PWA / home-screen icons -->
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <meta name="theme-color" content="#111111" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="FOUND" />
    <!-- Open Graph / iMessage / social link previews -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="FOUND" />
    <meta property="og:title" content="FOUND — Find Your People" />
    <meta property="og:description" content="Connect with Christians in your city. Discover community, join groups, and build real friendships." />
    <meta property="og:image" content="https://found-community.vercel.app/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:url" content="https://found-community.vercel.app" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="FOUND — Find Your People" />
    <meta name="twitter:description" content="Connect with Christians in your city. Discover community, join groups, and build real friendships." />
    <meta name="twitter:image" content="https://found-community.vercel.app/og-image.png" />`;

// Insert just before </head>
if (html.includes('<!-- PWA / home-screen icons -->')) {
  console.log('PWA tags already present, skipping injection');
} else {
  html = html.replace('</head>', pwaTags + '\n  </head>');
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('Injected PWA + OG meta tags into dist/index.html');
}

console.log('Postbuild complete.');
