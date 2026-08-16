export const metadata = {
  title: "ChemE Tutor",
  description: "Voice office hours for chemical engineering",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "ChemE Tutor" },
};

export const viewport = {
  themeColor: "#0E1A1E",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#0E1A1E",
          WebkitFontSmoothing: "antialiased",
          fontFamily:
            "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}
