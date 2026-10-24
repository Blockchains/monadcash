import './globals.css';
import type { Metadata, Viewport } from 'next';
const BP = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const CANONICAL = 'https://monaf.ai/';
const TITLE = 'MONAF · Programmable money for you and your agents';
const DESCRIPTION = 'MONAF.ai shows every vault, pool, aprMON balance and staked token this wallet owns on Monad. Withdraw, claim, or fund an agent. Your wallet signs. No promised return.';
export const metadata: Metadata = {
  metadataBase: new URL('https://monaf.ai'),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: 'MONAF',
  keywords: ['MONAF', 'MONAF.ai', 'Monad', 'MON', 'agent vault', 'aprMON', 'programmable money'],
  alternates: { canonical: CANONICAL, languages: { en: CANONICAL, 'x-default': CANONICAL } },
  robots: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  openGraph: { title: TITLE, description: DESCRIPTION, url: CANONICAL, siteName: 'MONAF', type: 'website', locale: 'en_GB' },
  twitter: { card: 'summary', title: TITLE, description: DESCRIPTION },
  manifest: `${BP}/manifest.webmanifest`,
  icons: { icon: [{ url: `${BP}/favicon.svg`, type: 'image/svg+xml' }], apple: `${BP}/favicon.svg` },
  appleWebApp: { capable: true, title: 'MONAF', statusBarStyle: 'black-translucent' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#09090b', colorScheme: 'dark' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="min-h-dvh bg-ink bg-[radial-gradient(ellipse_at_top,rgba(131,110,249,0.16),transparent_60%)] text-zinc-200 antialiased [-webkit-tap-highlight-color:transparent]">{children}</body></html>;
}
