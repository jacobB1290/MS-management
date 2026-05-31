import type { Metadata, Viewport } from "next"
import { Inter, Playfair_Display } from "next/font/google"
import { Toaster } from "sonner"
import { IOS_STARTUP_IMAGES } from "@/lib/ios-startup-images"
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
    default: "Morning Star Management",
    template: "%s · MS Management",
  },
  description: "Staff console for Morning Star Christian Church.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "MS Mgmt",
    // black-translucent: the warm cream surface flows under the iOS
    // status bar instead of getting a hard white bar above it.
    statusBarStyle: "black-translucent",
    // Native launch screens, shown during the standalone cold-launch gap so
    // it's a branded splash, not a blank page. icon.tsx / apple-icon.tsx still
    // own the home-screen icon; `startupImage` only adds the launch screens.
    startupImage: IOS_STARTUP_IMAGES,
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  // Resize the layout when the on-screen keyboard opens so the sticky compose
  // bar stays above it instead of being covered. (PlatformEnhancements covers
  // WebKit, which doesn't honor this yet.)
  interactiveWidget: "resizes-content",
  themeColor: "#f6f1ea",
  // Light-only product: keep WebKit from inverting form controls / scrollbars
  // in Dark Mode. Mirrors `color-scheme: light` in globals.css.
  colorScheme: "light",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
      <body className="bg-bg text-ink antialiased">
        {children}
        <Toaster
          position="bottom-center"
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
