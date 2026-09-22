import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { SideNav, TopNav } from '@/components/layout/nav';
import { accentStyle } from '@/components/accounts/identity';
import { getSessionUser } from '@/lib/auth/session';
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

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  /*
   * The session is resolved once, here, and the chrome is rendered from it.
   * The navigation is a client component and could not read a cookie anyway,
   * and every page already declares `force-dynamic`, so nothing is lost by
   * making the layout dynamic too.
   *
   * A session that cannot be read at all is treated as signed out rather than
   * as a crash: that lands on the account picker, which is somewhere a person
   * can act from. A blank window is not.
   */
  const user = await getSessionUser().catch(() => null);

  return (
    <html
      lang="en-GB"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The account's accent, applied to the whole application. Signed out it
      // is left alone, so the picker keeps the default gold until a career
      // claims the window.
      style={user ? accentStyle(user.accentKey) : undefined}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        {user ? (
          <div className="flex min-h-screen">
            <SideNav user={user} />
            <div className="flex min-w-0 flex-1 flex-col">
              <TopNav user={user} />
              <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">{children}</main>
            </div>
          </div>
        ) : (
          /*
           * Signed out, the account screens own the entire window: no rail, no
           * top bar. That is what makes opening this feel like opening an
           * application rather than visiting a site with an empty sidebar.
           */
          <main className="min-h-screen">{children}</main>
        )}
      </body>
    </html>
  );
}
