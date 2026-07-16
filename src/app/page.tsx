import Link from "next/link";

// Hoy solo Calidad está en alcance. Para reactivar un módulo (Producción,
// Depósito): agregar acá su objeto (ver git history de este archivo para las
// cards originales) y crear su page en src/app/<id>/. El enum ModuloApp del
// schema ya los contempla — no hace falta migración.
const modulos = [
  {
    id: "calidad",
    titulo: "Calidad",
    descripcion: "Registros de puntos de control, defectos, pesos y trazabilidad por lote",
    href: "/calidad",
    disponible: true,
    icono: (
      <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" />
      </svg>
    ),
    color: "from-[#E1000F] to-[#c0000d]",
    bgLight: "bg-red-50",
    textColor: "text-[#E1000F]",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#E1000F] flex items-center justify-center">
            <span className="text-white font-bold text-lg">LC</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 leading-tight">La Cumbre</h1>
            <p className="text-xs text-gray-500">Control de Producción</p>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Módulos</h2>
          <p className="text-gray-500 mt-1">Seleccioná el módulo con el que querés trabajar</p>
        </div>

        {/* max-w por card: con un solo módulo activo el grid colapsa a una
            columna de ancho contenido en vez de una card gigante full-width */}
        <div className="grid grid-cols-1 gap-6 max-w-md">
          {modulos.map((modulo) => (
            <ModuloCard key={modulo.id} modulo={modulo} />
          ))}
        </div>
      </main>
    </div>
  );
}

type ModuloCardProps = {
  modulo: (typeof modulos)[number];
};

function ModuloCard({ modulo }: ModuloCardProps) {
  const Wrapper = modulo.disponible ? Link : "div";
  const wrapperProps = modulo.disponible
    ? { href: modulo.href }
    : {};

  return (
    // @ts-expect-error — Link y div tienen props incompatibles pero es seguro aquí
    <Wrapper
      {...wrapperProps}
      className={`
        block bg-white rounded-2xl p-6 shadow-sm border border-gray-100
        transition-all duration-200
        ${modulo.disponible
          ? "hover:shadow-lg hover:-translate-y-1 cursor-pointer active:scale-95"
          : "opacity-60 cursor-not-allowed"
        }
      `}
    >
      {/* Icono */}
      <div className={`inline-flex p-3 rounded-xl ${modulo.bgLight} ${modulo.textColor} mb-4`}>
        {modulo.icono}
      </div>

      {/* Título y badge */}
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-xl font-bold text-gray-900">{modulo.titulo}</h3>
        {!modulo.disponible && (
          <span className="text-xs font-medium bg-gray-100 text-gray-500 px-2 py-1 rounded-full">
            Próximamente
          </span>
        )}
      </div>

      <p className="text-sm text-gray-500 leading-relaxed">{modulo.descripcion}</p>

      {modulo.disponible && (
        <div className={`mt-4 flex items-center gap-1 text-sm font-semibold ${modulo.textColor}`}>
          <span>Abrir módulo</span>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      )}
    </Wrapper>
  );
}
