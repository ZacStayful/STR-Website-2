/**
 * Batch 22f: who may put our pages in a frame. Only the white-label lead
 * form (/f/*) may be embedded, by anyone: a management company puts it on its
 * own website. Every other page may be framed by this site alone (the case
 * study PDFs are shown in our own frames), and by nobody else.
 *
 * Read by next.config.ts. Pure, so the matching is tested.
 */

export interface HeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

export const FRAME_HEADERS: HeaderRule[] = [
  {
    // Every path except /f/…: the home page has no segment, so it is listed on its own.
    source: '/',
    headers: [
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
    ],
  },
  {
    source: '/:path((?!f/|f$).*)',
    headers: [
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
    ],
  },
  {
    source: '/f/:path*',
    headers: [{ key: 'Content-Security-Policy', value: 'frame-ancestors *' }],
  },
];
