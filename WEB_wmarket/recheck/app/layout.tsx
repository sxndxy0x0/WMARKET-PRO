import type { Metadata } from 'next';
import { Inter, Noto_Sans_Thai } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { WatchlistProvider } from '@/lib/watchlist-context';
import { LiveStatusProvider } from '@/lib/live-status-context';
import { SidePanelProvider } from '@/lib/side-panel-context';
import { MotionProvider } from '@/components/motion';
import { ThemeProvider } from '@/lib/theme-context';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const thai = Noto_Sans_Thai({ subsets: ['thai'], variable: '--font-thai', weight: ['400', '500', '600', '700', '800'], display: 'swap' });

export const metadata: Metadata = {
  title: 'WMarket — ราคาตลาด Minecraft',
  description: 'ตรวจสอบราคาสินค้า Minecraft และการเปลี่ยนแปลงราคาแบบเรียลไทม์',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${inter.variable} ${thai.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply the stored theme before first paint — no light/dark flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=localStorage.getItem('wm-theme')||'auto';var h=new Date().getHours();var t=p==='auto'?(h>=6&&h<18?'light':'dark'):p;document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`,
          }}
        />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <MotionProvider>
          <ThemeProvider>
            <AuthProvider>
              <WatchlistProvider>
                <LiveStatusProvider>
                  <SidePanelProvider>
                    <div className="min-h-screen">{children}</div>
                  </SidePanelProvider>
                </LiveStatusProvider>
              </WatchlistProvider>
            </AuthProvider>
          </ThemeProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
