import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'SIE Analys',
  description: 'Ekonomisk analys för svenska SME',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin:0, background:'#0d0d0f', color:'#e8e8ed', fontFamily:'DM Sans, sans-serif' }}>
        {children}
      </body>
    </html>
  )
}