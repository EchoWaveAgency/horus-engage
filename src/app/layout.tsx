import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "./globals.css";
import { cookies } from "next/headers";

export const metadata = { title: { default: "HORUS Engage", template: "%s · HORUS Engage" }, robots: { index: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = cookies().get("eg_lang")?.value === "en" ? "en" : "ar";
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
