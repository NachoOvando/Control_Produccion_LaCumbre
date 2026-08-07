import type { Metadata, Viewport } from "next";
// @ts-expect-error — Tailwind CSS v4 global import (no type declarations needed)
import "./globals.css";
import { SessionProvider } from "@/components/providers/SessionProvider";

export const metadata: Metadata = {
  title: "La Cumbre — Control de Producción",
  description: "Plataforma industrial de gestión de calidad, producción y depósito",
  // Habilita el prompt de instalación de la PWA. El manifest se declara en
  // src/app/manifest.ts y Next lo sirve en esta ruta.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "LC Calidad",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#E1000F",
  // `maximumScale` y `userScalable` se dejan en su default (zoom PERMITIDO) a
  // propósito. Es tentador bloquear el zoom en una app de tablet para que un
  // toque con guantes no la desarme, pero bloquearlo rompe la accesibilidad para
  // cualquier operario que necesite agrandar el texto — y en planta, con luz
  // mala y pantallas sucias, eso pasa.
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-[#f5f5f5]">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
