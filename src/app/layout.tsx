import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { SideNav, TopNav } from '@/components/layout/nav';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: 'Endurance Racing Career Mode',
    template: '%s · Endurance Career',
  },
  description:
    'A permanent career record for endurance racing. Track complete races, not highlights.',
};

export const viewport: Viewport = {
  themeColor: '#0b0e12',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en-GB"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <div className="flex min-h-screen">
          <SideNav />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopNav />
            <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
