import type { Metadata } from "next";
// @ts-expect-error — Tailwind CSS v4 global import (no type declarations needed)
import "./globals.css";
import { SessionProvider } from "@/components/providers/SessionProvider";

export const metadata: Metadata = {
  title: "La Cumbre — Control de Producción",
  description: "Plataforma industrial de gestión de calidad, producción y depósito",
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
