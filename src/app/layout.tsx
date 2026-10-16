import type { Metadata, Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';
import '@fontsource-variable/fraunces/wght.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jevassic Park — The AI operated theme park',
  description: 'Watch Jev choose what every guest does in a living theme park simulation.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0d1b1e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="bg-[#080f12] text-[#e9f2ed] antialiased font-sans">{children}<Analytics /></body></html>;
}
