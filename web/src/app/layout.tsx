import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'PolicyPilot · Monad dashboard', description: 'Live policy-bounded agent payments on Monad' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="min-h-screen bg-ink bg-[radial-gradient(ellipse_at_top,rgba(131,110,249,0.18),transparent_60%)] antialiased">{children}</body></html>;
}
