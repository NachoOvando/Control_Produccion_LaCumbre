import Link from "next/link";

export const dynamic = "force-dynamic";

// El Maestro de Productos ya NO es una funcionalidad de Calidad: se movió a
// módulo top-level (/maestro), hermano de Calidad — ver src/app/page.tsx.
const FUNCIONALIDADES = [
  {
    slug: "puntos-control",
    nombre: "Puntos de Control",
    descripcion: "Registro de controles de calidad por línea productiva",
    icono: (
      <svg className="w-7 h-7 text-[#E1000F]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
      </svg>
    ),
    activo: true,
  },
  {
    slug: "reportes",
    nombre: "Reportes",
    descripcion: "Análisis de tendencias, estadísticas y exportación de datos",
    icono: (
      <svg className="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
    activo: false,
  },
  {
    slug: "auditoria",
    nombre: "Auditoría",
    descripcion: "Historial de cambios, trazabilidad HACCP y registros inmutables",
    icono: (
      <svg className="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
      </svg>
    ),
    activo: false,
  },
  {
    slug: "lotes",
    nombre: "Lotes",
    descripcion: "Gestión de lotes de producción y trazabilidad de insumos",
    icono: (
      <svg className="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
      </svg>
    ),
    activo: false,
  },
];

export default function CalidadHubPage() {
  const funcionalidades = FUNCIONALIDADES;

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#E1000F] flex items-center justify-center">
              <span className="text-white font-bold text-lg">LC</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 leading-tight">La Cumbre</h1>
              <p className="text-xs text-gray-500">Control de Producción</p>
            </div>
          </Link>
          <div className="ml-2 flex items-center gap-2 text-gray-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-sm font-semibold text-[#E1000F]">Calidad</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900">Área de Calidad</h2>
          <p className="text-sm text-gray-500 mt-1">Seleccioná la funcionalidad con la que querés trabajar</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {funcionalidades.map((f) =>
            f.activo ? (
              <Link
                key={f.slug}
                href={`/calidad/${f.slug}`}
                className="block bg-white rounded-2xl p-6 border border-gray-200 hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 active:scale-95"
              >
                <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center mb-4">
                  {f.icono}
                </div>
                <h3 className="font-bold text-gray-900 text-base">{f.nombre}</h3>
                <p className="text-sm text-gray-500 mt-1 leading-relaxed">{f.descripcion}</p>
                <div className="mt-4 flex items-center gap-1 text-sm font-semibold text-[#E1000F]">
                  <span>Abrir</span>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ) : (
              <div
                key={f.slug}
                className="block bg-white rounded-2xl p-6 border border-gray-200 opacity-60 cursor-not-allowed"
              >
                <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mb-4">
                  {f.icono}
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-gray-500 text-base">{f.nombre}</h3>
                  <span className="text-xs bg-gray-100 text-gray-500 font-semibold px-2 py-0.5 rounded-full">
                    Próximamente
                  </span>
                </div>
                <p className="text-sm text-gray-400 leading-relaxed">{f.descripcion}</p>
              </div>
            )
          )}
        </div>
      </main>
    </div>
  );
}
