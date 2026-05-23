import type { Metadata, Viewport } from "next"
import { Inter, Playfair_Display } from "next/font/google"
import { Toaster } from "sonner"
import "./globals.css"

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
})

const playfair = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
})

export const metadata: Metadata = {
  title: {
    default: "Morning Star — Management",
    template: "%s · MS Management",
  },
  description: "Staff console for Morning Star Christian Church.",
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f1ea",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
      <body className="min-h-dvh bg-bg text-ink antialiased">
        {children}
        <Toaster
          position="top-right"
          richColors
          theme="light"
          toastOptions={{
            classNames: {
              toast:
                "!bg-white !text-ink !border !border-ink-hairline !shadow-md !rounded-[16px]",
              title: "!font-medium",
            },
          }}
        />
      </body>
    </html>
  )
}
