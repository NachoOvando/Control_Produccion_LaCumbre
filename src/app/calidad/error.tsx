"use client";

// Error boundary del módulo de Calidad. Nunca interpolar error.message en el
// mensaje mostrado — puede filtrar detalles de Prisma/DB al operario de planta.
export default function CalidadError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen bg-[#f5f5f5] flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-white rounded-2xl p-6 text-center shadow-sm border border-gray-100">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
          <svg className="w-7 h-7 text-[#E1000F]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-gray-900 mb-1">No se pudo cargar Calidad</h1>
        <p className="text-sm text-gray-500 mb-5">
          Reintentá en unos segundos. Si el problema continúa, contactá a sistemas.
        </p>
        <button
          type="button"
          onClick={reset}
          className="w-full py-3 rounded-xl text-sm font-bold text-white bg-[#E1000F] hover:bg-[#c0000d] active:scale-95 transition-all"
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}
