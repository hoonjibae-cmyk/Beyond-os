import './globals.css';

export const metadata = {
  title: 'Beyond OS',
  description: 'The Place 26 study management dashboard',
  applicationName: 'Beyond OS',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/beyond-os-icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/beyond-os-icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'Beyond OS',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport = {
  themeColor: '#211f1b',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
