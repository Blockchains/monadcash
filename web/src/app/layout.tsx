import './globals.css';
import type { Metadata, Viewport } from 'next';
const BP = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const metadata: Metadata = {
  metadataBase: new URL('https://blockchains.github.io'),
  title: 'PolicyPilot · Love agents. Love control.',
  description: 'Put a harness on your AI agent’s spending on Monad: budget, per-action cap, allowed services, kill switch. Enforced on-chain.',
  manifest: `${BP}/manifest.webmanifest`,
  icons: { icon: `${BP}/favicon.png`, apple: `${BP}/apple-touch-icon.png` },
  appleWebApp: { capable: true, title: 'PolicyPilot', statusBarStyle: 'black-translucent' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#09090b', colorScheme: 'dark' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="min-h-dvh bg-ink bg-[radial-gradient(ellipse_at_top,rgba(131,110,249,0.16),transparent_60%)] text-zinc-200 antialiased [-webkit-tap-highlight-color:transparent]">{children}</body></html>;
}
