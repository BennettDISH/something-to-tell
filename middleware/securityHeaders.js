import helmet from 'helmet';

// The bug tracker's widget: index.html loads widget.js from here and the widget posts reports
// back to it. It also injects a <style> into a shadow root, hence 'unsafe-inline' in styles, and
// resizes a screenshot through a blob: image.
export const WIDGET_ORIGIN = 'https://bug-tracker-production-4ccb.up.railway.app';

// The session token sits in localStorage, and secrets are what this app holds, so the page may
// run only its own scripts and the widget's, and talk only to itself and the widget's server.
// On top of helmet's defaults (default-src 'self', object-src 'none', script-src-attr 'none',
// frame-ancestors 'self'): the widget, and the Inter and JetBrains Mono fonts App.scss imports
// from Google Fonts. No upgrade-insecure-requests: production is https already, and a local run
// is http.
export const CSP_DIRECTIVES = {
  'script-src': ["'self'", WIDGET_ORIGIN],
  'connect-src': ["'self'", WIDGET_ORIGIN],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  'font-src': ["'self'", 'https://fonts.gstatic.com'],
  'img-src': ["'self'", 'data:', 'blob:'],
  'upgrade-insecure-requests': null,
};

export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: { directives: CSP_DIRECTIVES },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
}
