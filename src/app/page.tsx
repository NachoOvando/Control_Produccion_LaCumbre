import Link from "next/link";
import { auth } from "@/lib/auth";
import { ROLES_ADMIN_MAESTRO, tieneRol } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

type Modulo = {
  id: string;
  titulo: string;
  descripcion: string;
  href: string;
  disponible: boolean;
  icono: React.ReactNode;
  bgLight: string;
  textColor: string;
  soloAdmin?: boolean;
};

// Hoy Calidad y Maestro de Productos están en alcance, como módulos hermanos.
// Para reactivar un módulo (Producción, Depósito): agregar acá su objeto (ver
// git history de este archivo para las cards originales) y crear su page en
// src/app/<id>/. El enum ModuloApp del schema ya los contempla — sin migración.
// El Maestro es transversal (datos maestros que consume Calidad), no una
// función interna de Calidad — por eso vive al mismo nivel, gateado a admin.
const modulos: Modulo[] = [
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
    bgLight: "bg-red-50",
    textColor: "text-[#E1000F]",
  },
  {
    id: "maestro",
    titulo: "Maestro de Productos",
    descripcion: "Alta y edición de productos, marcas, familias y especificaciones de calidad",
    href: "/maestro",
    disponible: true,
    soloAdmin: true,
    icono: (
      <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
      </svg>
    ),
    bgLight: "bg-red-50",
    textColor: "text-[#E1000F]",
  },
];

export default async function HomePage() {
  const session = await auth();
  const esAdmin = tieneRol(session?.user?.rol as string | undefined, ROLES_ADMIN_MAESTRO);
  // El maestro solo se muestra a admin; el resto de los módulos, a todos.
  const modulosVisibles = modulos.filter((m) => !m.soloAdmin || esAdmin);

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

        {/* 1 columna con un solo módulo (ancho contenido); 2 columnas cuando
            además está visible el maestro (admin) */}
        <div className={`grid grid-cols-1 gap-6 ${modulosVisibles.length > 1 ? "sm:grid-cols-2 max-w-3xl" : "max-w-md"}`}>
          {modulosVisibles.map((modulo) => (
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
