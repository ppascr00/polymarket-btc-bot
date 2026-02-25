import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'Polymarket BTC Bot — Dashboard',
    description: 'Trading bot dashboard for BTC 5m Up/Down markets',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <head>
                <link
                    href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
                    rel="stylesheet"
                />
            </head>
            <body>{children}</body>
        </html>
    );
}
