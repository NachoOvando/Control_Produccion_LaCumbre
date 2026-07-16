"use client";

import { useRouter } from "next/navigation";
import type { ProductoActivoLinea } from "@/types/calidad";

type Props = {
  productoActivo: ProductoActivoLinea;
  lineaId: string;
};

// Solo lectura — el producto/lote de la línea ya viene resuelto server-side
// (LineaProduccionEstado). Reemplaza el <select> "Producto en producción" que
// antes se repetía en cada formulario; para un changeover hay que volver
// explícitamente al selector de línea ("Cambiar producto").
export function ProductoActivoBanner({ productoActivo, lineaId }: Props) {
  const router = useRouter();

  // "Cambiar producto" abandona el formulario en curso — a diferencia del viejo
  // <select>, este es un link de navegación real dentro de un form de captura
  // que puede tener muestras sin guardar. Confirmar siempre (acción poco
  // frecuente, un changeover) evita perder una jornada de datos por un toque
  // accidental en tablet.
  function onCambiarProducto() {
    if (!confirm("Si hay datos sin guardar en este formulario se van a perder. ¿Cambiar de producto igual?")) return;
    router.push(`/calidad/puntos-control?linea=${lineaId}`);
  }

  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-100 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Producto en producción</p>
        <p className="font-bold text-gray-900 truncate">
          {productoActivo.productoNombre} — Lote {productoActivo.numeroLote}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">Activado por {productoActivo.activadoPorNombre}</p>
      </div>
      <button
        type="button"
        onClick={onCambiarProducto}
        className="flex-shrink-0 text-xs font-semibold text-[#E1000F] hover:underline whitespace-nowrap"
      >
        Cambiar producto
      </button>
    </div>
  );
}
