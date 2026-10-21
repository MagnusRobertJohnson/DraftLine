import type { Metadata } from 'next';
import './globals.css';
import AppHeader from '@/components/AppHeader';

export const metadata: Metadata = {
  title: 'HockeyPool | Fantasy Hockey Draft Pools',
  description: 'Create, draft, and manage fantasy hockey pools across web and mobile.',
};

const themeScript = `try{var t=localStorage.getItem('theme');if(t==='light'||(t!=='dark'&&window.matchMedia('(prefers-color-scheme: light)').matches)){document.documentElement.classList.add('light')}}catch(e){}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-rink-dark text-slate-100 min-h-screen flex flex-col antialiased">
        <AppHeader />
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6">{children}</main>
        <footer className="border-t border-rink-border/50 py-6 text-center text-xs text-slate-400">
          HockeyPool © 2026 • Live Sync Web & Mobile Fantasy Hockey Platform
        </footer>
      </body>
    </html>
  );
}
