"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ProductoActivoLinea } from "@/types/calidad";

export type FamiliaResumen = { slug: string; nombre: string };

type PuntoControlResumen = {
  id: string;
  nombre: string;
  descripcion: string | null;
  orden: number;
  seccion?: string;
  familias?: FamiliaResumen[];
};

type LineaResumen = {
  id: string;
  nombre: string;
  descripcion: string | null;
  puntosControl: PuntoControlResumen[];
};

type ProductoOption = {
  id: string;
  nombre: string;
  familia: { nombre: string };
  marca: { nombre: string };
  // null = sin línea asignada en el maestro (34/104 productos) — se muestra en
  // el selector de toda línea. Con línea asignada, solo aparece en la suya.
  lineaProductivaId: string | null;
};

type Props = {
  lineas: LineaResumen[];
  // Catálogo para el selector de "producto a producir" al entrar a una línea.
  productos: ProductoOption[];
  // Restaura la línea activa al volver desde un punto de control
  // (ver back link en [lineaId]/[puntoControlId]/page.tsx).
  lineaInicialId?: string;
};

// Flujo asistente (vistas modelo del usuario): primero se elige la línea a
// controlar, después SIEMPRE se confirma el producto a fabricar (si la línea ya
// tiene producto activo hoy, aparece preseleccionado — pero el paso no se
// saltea), y recién ahí se ven los puntos de control. Única excepción: volver
// "atrás" desde un punto de control restaura la grilla directamente sin
// re-preguntar (fricción innecesaria en medio de una jornada de captura).
type Paso = "cargando" | "linea" | "producto" | "grilla";

// La línea activa persiste por pestaña (sessionStorage): el botón "atrás" del
// browser y los re-montajes de la page no deben resetear al operario al paso de
// selección de línea en medio de una jornada. Se limpia solo con un cambio
// explícito ("Cambiar de Línea" / "Volver a elegir línea") o al cerrar la pestaña.
const LINEA_STORAGE_KEY = "calidad:lineaActiva";

export function CalidadModuloView({ lineas, productos, lineaInicialId }: Props) {
  const lineaInicialValida = lineaInicialId && lineas.some((l) => l.id === lineaInicialId);

  const [paso, setPaso] = useState<Paso>(lineaInicialValida ? "cargando" : "linea");
  const [lineaActivaId, setLineaActivaId] = useState<string | null>(
    lineaInicialValida ? lineaInicialId! : null
  );
  // Valor del <select> del paso "linea" (todavía no confirmado con Avanzar)
  const [lineaSeleccionada, setLineaSeleccionada] = useState("");

  const [productoActivo, setProductoActivo] = useState<ProductoActivoLinea | null>(null);
  const [cargandoActivo, setCargandoActivo] = useState(false);
  const [errorCargaActivo, setErrorCargaActivo] = useState<string | null>(null);
  // Incrementarlo fuerza un refetch aunque lineaActivaId no cambie — reintento
  // manual tras error, o reconfirmar la misma línea (otro operario pudo haber
  // hecho un changeover mientras tanto; no hay que confiar en el estado en memoria).
  const [recargaNonce, setRecargaNonce] = useState(0);
  // Solo la restauración por ?linea= (volver de un PC) salta directo a la grilla;
  // el flujo normal de entrada SIEMPRE pasa por el paso de producto para confirmar.
  const esRestauracion = useRef(Boolean(lineaInicialValida));
  const [productoSeleccionado, setProductoSeleccionado] = useState("");
  const [activando, setActivando] = useState(false);
  const [errorActivacion, setErrorActivacion] = useState<string | null>(null);

  // Restauración por sessionStorage cuando la URL no trae ?linea= (típico: botón
  // "atrás" del browser, que vuelve a /calidad/puntos-control pelado). Corre en
  // un efecto de montaje — no en el init de useState — porque el componente se
  // server-renderiza y sessionStorage solo existe en el cliente (evita hydration
  // mismatch). La prioridad la tiene ?linea= (prop), que ya viene resuelta.
  useEffect(() => {
    if (lineaInicialValida) return;
    const guardada = sessionStorage.getItem(LINEA_STORAGE_KEY);
    if (guardada && lineas.some((l) => l.id === guardada)) {
      esRestauracion.current = true;
      setPaso("cargando");
      setLineaActivaId(guardada);
    }
    // Solo al montar: después de eso la línea la maneja el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolver el producto activo de la línea confirmada. El flujo normal SIEMPRE
  // pasa por el paso de producto (con el activo preseleccionado si existe); solo
  // la restauración por query param va directo a la grilla. El guard `cancelado`
  // evita setState de un fetch obsoleto si se cambia de línea en vuelo. Un fallo
  // de red NO se interpreta como "sin producto activo" — eso llevaría a pisar el
  // lote de la línea por error; se muestra un estado de reintento.
  useEffect(() => {
    if (!lineaActivaId) return;
    let cancelado = false;
    setCargandoActivo(true);
    setErrorCargaActivo(null);
    fetch(`/api/v1/lineas-productivas/${lineaActivaId}/producto-activo`)
      .then((r) => {
        // Sesión inválida (ej. JWT viejo que la revalidación contra DB mató):
        // re-loguear, no mostrar un error críptico ni seguir operando.
        if (r.status === 401) {
          window.location.assign("/login");
          return null;
        }
        // Un error del server NO se interpreta como "sin producto activo"
        // (json.data undefined pisaría el lote de la línea) — va al catch.
        if (!r.ok) throw new Error(`producto-activo respondió ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelado || json === null) return;
        // Línea resuelta con éxito → recordarla para esta pestaña (ver LINEA_STORAGE_KEY)
        sessionStorage.setItem(LINEA_STORAGE_KEY, lineaActivaId);
        const activo: ProductoActivoLinea | null = json.data ?? null;
        setProductoActivo(activo);
        if (esRestauracion.current && activo) {
          setPaso("grilla");
          setProductoSeleccionado("");
        } else {
          setPaso("producto");
          // Preseleccionar el producto activo para que "Avanzar" sea una confirmación
          setProductoSeleccionado(activo?.productoId ?? "");
        }
        esRestauracion.current = false;
        setErrorActivacion(null);
      })
      .catch(() => {
        if (cancelado) return;
        esRestauracion.current = false;
        setErrorCargaActivo("No se pudo verificar el producto activo de la línea. Reintentá.");
        setPaso("linea");
      })
      .finally(() => {
        if (!cancelado) setCargandoActivo(false);
      });
    return () => { cancelado = true; };
  }, [lineaActivaId, recargaNonce]);

  // Agrupar por familia reduce el escaneo lineal de la lista completa de productos
  const productosPorFamilia = useMemo(() => {
    const grupos: Record<string, typeof productos> = {};
    // Solo productos de esta línea (o sin línea asignada en el maestro) —
    // evita activar en una línea un producto que pertenece a otra.
    const productosDeLaLinea = productos.filter(
      (p) => p.lineaProductivaId === null || p.lineaProductivaId === lineaActivaId
    );
    for (const p of productosDeLaLinea) {
      (grupos[p.familia.nombre] ??= []).push(p);
    }
    return grupos;
  }, [productos, lineaActivaId]);

  function avanzarLinea() {
    if (!lineaSeleccionada) return;
    if (lineaSeleccionada === lineaActivaId) {
      // Misma línea ya resuelta — igual se refetchea (recargaNonce fuerza el
      // efecto aunque lineaActivaId no cambie): el estado en memoria puede estar
      // desactualizado si otro operario activó un producto distinto mientras tanto.
      setRecargaNonce((n) => n + 1);
      return;
    }
    setProductoActivo(null);
    setLineaActivaId(lineaSeleccionada);
  }

  async function activarProducto() {
    if (!productoSeleccionado || !lineaActivaId) return;

    // Confirmar el producto que ya está activo no requiere POST: no hay cambio
    // de estado que registrar (y una activación redundante chocaría con el
    // cooldown del guard y ensuciaría LineaActivacionLog).
    if (productoActivo && productoSeleccionado === productoActivo.productoId) {
      setProductoSeleccionado("");
      setErrorActivacion(null);
      setPaso("grilla");
      return;
    }

    setActivando(true);
    setErrorActivacion(null);
    try {
      const res = await fetch(`/api/v1/lineas-productivas/${lineaActivaId}/producto-activo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productoId: productoSeleccionado }),
      });
      // Sesión inválida → re-loguear (mismo criterio que el GET de arriba)
      if (res.status === 401) {
        window.location.assign("/login");
        return;
      }
      const json = await res.json();
      if (!res.ok) {
        setErrorActivacion(json.error ?? "Error al activar el producto.");
        return;
      }
      setProductoActivo(json.data);
      setProductoSeleccionado("");
      setPaso("grilla");
    } catch {
      setErrorActivacion("Error de conexión. Verificá la red e intentá de nuevo.");
    } finally {
      setActivando(false);
    }
  }

  const lineaActiva = lineas.find((l) => l.id === lineaActivaId);

  // El filtro por familia se deriva del producto activo (la familia está incluida
  // en el producto seleccionado) — no hay filtro manual de familia en la UI.
  const familiaDelProducto = productoActivo?.familiaSlug ?? null;
  const pcsFiltrados = lineaActiva?.puntosControl.filter((pc) => {
    const fams = pc.familias ?? [];
    // PCs sin familia asignada siempre se muestran
    if (fams.length === 0) return true;
    if (!familiaDelProducto) return true;
    return fams.some((f) => f.slug === familiaDelProducto);
  }) ?? [];

  // Agrupar por sección
  const secciones = pcsFiltrados.reduce<Record<string, PuntoControlResumen[]>>(
    (acc, pc) => {
      const sec = pc.seccion || "__sin_seccion__";
      if (!acc[sec]) acc[sec] = [];
      acc[sec].push(pc);
      return acc;
    },
    {}
  );

  const seccionesOrdenadas = Object.entries(secciones).sort(([a], [b]) => {
    // "__sin_seccion__" va al final; el resto respeta el orden de aparición
    if (a === "__sin_seccion__") return 1;
    if (b === "__sin_seccion__") return -1;
    return 0;
  });

  if (lineas.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        No hay líneas productivas configuradas para el módulo de Calidad.
      </div>
    );
  }

  // ── Paso 0: restaurando línea al volver de un punto de control ─────────────
  // Pantalla dedicada (no el selector) para no dejar el <select> tocable con un
  // fetch en vuelo — evita que una elección del operario se descarte en pleno
  // vuelo cuando el fetch de restauración resuelve.
  if (paso === "cargando") {
    return (
      <div className="bg-[#d9d9d9] min-h-[calc(100vh-140px)] flex items-center justify-center p-4">
        <p className="text-sm text-gray-500">Cargando línea…</p>
      </div>
    );
  }

  // ── Paso 1: elegir línea productiva (Vista 1) ──────────────────────────────
  if (paso === "linea") {
    return (
      <div className="bg-[#d9d9d9] min-h-[calc(100vh-140px)] flex items-start justify-center p-4 pt-12">
        <div className="w-full max-w-md bg-white rounded-2xl p-8 shadow-sm space-y-8">
          <h2 className="text-lg font-bold text-gray-900 text-center">Línea Productiva</h2>
          <select
            value={lineaSeleccionada}
            onChange={(e) => setLineaSeleccionada(e.target.value)}
            className="w-full py-3 px-4 rounded-xl border-2 border-gray-200 bg-gray-50 font-medium text-gray-900 focus:border-[#E1000F] focus:outline-none"
          >
            <option value="">— Elegir línea —</option>
            {lineas.map((l) => (
              <option key={l.id} value={l.id}>{l.nombre}</option>
            ))}
          </select>

          {errorCargaActivo && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
              <p className="text-sm text-red-700">{errorCargaActivo}</p>
              {lineaActivaId && (
                <button
                  type="button"
                  onClick={() => setRecargaNonce((n) => n + 1)}
                  className="text-sm font-semibold text-red-700 hover:underline"
                >
                  Reintentar
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={avanzarLinea}
            disabled={!lineaSeleccionada || cargandoActivo}
            className="w-full py-4 rounded-2xl text-base font-bold text-white bg-[#E1000F] hover:bg-[#c0000d] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-200"
          >
            {cargandoActivo ? "Cargando…" : "Avanzar"}
          </button>
        </div>
      </div>
    );
  }

  // ── Paso 2: elegir producto a fabricar (Vista 2) ───────────────────────────
  if (paso === "producto") {
    // Confirmar el producto ya activo (sin POST) vs. changeover real (nuevo lote,
    // se registra en LineaActivacionLog) deben distinguirse visualmente — un
    // mis-tap en el select no debe pasar desapercibido como un cambio de producto.
    const esCambioDeProducto = Boolean(
      productoActivo && productoSeleccionado && productoSeleccionado !== productoActivo.productoId
    );
    return (
      <div className="bg-[#d9d9d9] min-h-[calc(100vh-140px)] flex items-start justify-center p-4 pt-12">
        <div className="w-full max-w-md bg-white rounded-2xl p-8 shadow-sm space-y-6">
          <div className="text-center space-y-1">
            <h2 className="text-lg font-bold text-gray-900">Seleccionar Producto a Fabricar</h2>
            {lineaActiva && <p className="text-xs text-gray-400">{lineaActiva.nombre}</p>}
          </div>

          {productoActivo && (
            <div className={`rounded-xl px-4 py-3 text-sm border ${
              esCambioDeProducto ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-transparent"
            }`}>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-0.5 ${esCambioDeProducto ? "text-amber-600" : "text-gray-400"}`}>
                Producto actual
              </p>
              <p className="font-medium text-gray-700 truncate">
                {productoActivo.productoNombre} — Lote {productoActivo.numeroLote}
              </p>
              {esCambioDeProducto && (
                <p className="text-xs text-amber-700 mt-1.5">
                  Vas a reemplazarlo y generar un lote nuevo para el producto elegido.
                </p>
              )}
            </div>
          )}

          <select
            value={productoSeleccionado}
            onChange={(e) => setProductoSeleccionado(e.target.value)}
            className="w-full py-3 px-4 rounded-xl border-2 border-gray-200 bg-gray-50 font-medium text-gray-900 focus:border-[#E1000F] focus:outline-none"
          >
            <option value="">— Elegir producto —</option>
            {Object.entries(productosPorFamilia).map(([familia, items]) => (
              <optgroup key={familia} label={familia}>
                {items.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre} ({p.marca.nombre})</option>
                ))}
              </optgroup>
            ))}
          </select>

          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold text-gray-600">Número de Lote:</span>
            {/* El número real lo genera el server al avanzar (placeholder GEN-...,
                reglas de numeración definitivas pendientes de definir) */}
            <span className="text-gray-400 italic">Se asigna automáticamente</span>
          </div>

          {errorActivacion && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{errorActivacion}</div>
          )}

          <div className="space-y-2">
            <button
              type="button"
              onClick={activarProducto}
              disabled={!productoSeleccionado || activando}
              className="w-full py-4 rounded-2xl text-base font-bold text-white bg-[#E1000F] hover:bg-[#c0000d] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-200"
            >
              {activando
                ? "Activando…"
                : !productoActivo
                ? "Avanzar"
                : esCambioDeProducto
                ? "Cambiar producto"
                : "Confirmar y avanzar"}
            </button>
            {productoActivo ? (
              <button
                type="button"
                onClick={() => { setPaso("grilla"); setProductoSeleccionado(""); setErrorActivacion(null); }}
                className="w-full py-3 rounded-2xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-all"
              >
                Cancelar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { sessionStorage.removeItem(LINEA_STORAGE_KEY); setPaso("linea"); setProductoSeleccionado(""); setErrorActivacion(null); }}
                className="w-full py-3 rounded-2xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-all"
              >
                Volver a elegir línea
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Paso 3: grilla de puntos de control (Vista 3) ──────────────────────────
  return (
    <div>
      {/* Contexto de trabajo: línea + producto + lote, con acciones para cambiar */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Producto en producción{lineaActiva ? ` — ${lineaActiva.nombre}` : ""}
            </p>
            {productoActivo && (
              <p className="font-bold text-gray-900 truncate">
                {productoActivo.productoNombre} — Lote {productoActivo.numeroLote}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <button
              type="button"
              onClick={() => { sessionStorage.removeItem(LINEA_STORAGE_KEY); setPaso("linea"); setLineaSeleccionada(""); }}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-all"
            >
              Cambiar de Línea
            </button>
            <button
              type="button"
              onClick={() => { setPaso("producto"); setProductoSeleccionado(""); setErrorActivacion(null); }}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[#E1000F] border border-[#E1000F] hover:bg-red-50 whitespace-nowrap transition-all"
            >
              Cambiar producto
            </button>
          </div>
        </div>
      </div>

      {/* Contenido por secciones — ya filtrado por la familia del producto activo */}
      <div className="bg-[#d9d9d9] min-h-[calc(100vh-200px)] p-4 space-y-6">
        {lineaActiva && (
          <>
            {pcsFiltrados.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <svg className="w-12 h-12 mx-auto mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
                </svg>
                {lineaActiva.puntosControl.length === 0 ? (
                  <>
                    <p className="font-medium">Sin puntos de control configurados</p>
                    <p className="text-xs mt-1">Contactar al administrador para configurar puntos de control para esta línea</p>
                  </>
                ) : (
                  <p className="font-medium">
                    Ningún punto de control aplica a {productoActivo?.productoNombre ?? "este producto"} en esta línea
                  </p>
                )}
              </div>
            ) : (
              seccionesOrdenadas.map(([seccion, pcs]) => (
                <div key={seccion}>
                  {seccion !== "__sin_seccion__" && (
                    <div className="flex items-center gap-3 mb-3">
                      <h2 className="text-sm font-bold text-gray-600 uppercase tracking-wider">
                        {seccion}
                      </h2>
                      <div className="flex-1 h-px bg-gray-400/40" />
                      <span className="text-xs text-gray-400 font-medium">
                        {pcs.length} {pcs.length === 1 ? "punto" : "puntos"}
                      </span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {pcs.map((pc) => (
                      <PuntoControlCard
                        key={pc.id}
                        puntoControl={pc}
                        lineaId={lineaActiva.id}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

type PuntoControlCardProps = {
  puntoControl: PuntoControlResumen;
  lineaId: string;
};

function PuntoControlCard({ puntoControl, lineaId }: PuntoControlCardProps) {
  // AUDIT_PLAN.md C7 (2026-07-20): heurística, no un campo estructural. Se
  // deriva del nombre de display porque hoy `PuntoControl` no tiene un campo
  // `esPuntoCritico` en el schema — un PCC real cuyo nombre no incluya
  // literalmente "PCC" deja de marcarse como crítico sin que nadie lo note.
  // El fix correcto (agregar el campo al modelo PuntoControl) requiere tocar
  // schema.prisma + migración + poblar el maestro/seed — fuera de alcance de
  // este fix menor, señalado para decisión explícita (ver AUDIT_PLAN.md).
  const esPCC = puntoControl.nombre.includes("PCC");

  return (
    <Link
      href={`/calidad/${lineaId}/${puntoControl.id}`}
      className="
        block bg-white rounded-2xl p-5 shadow-sm border border-white/50
        hover:shadow-md hover:-translate-y-0.5 transition-all duration-150
        active:scale-95
      "
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${esPCC ? "bg-red-100" : "bg-red-50"}`}>
        {esPCC ? (
          <svg className="w-6 h-6 text-[#E1000F]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        ) : (
          <svg className="w-6 h-6 text-[#E1000F]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
        </svg>
        )}
      </div>
      <h3 className="font-bold text-gray-900 text-sm leading-snug">{puntoControl.nombre}</h3>
      {puntoControl.descripcion && (
        <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2">
          {puntoControl.descripcion}
        </p>
      )}
      <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-[#E1000F]">
        <span>Registrar</span>
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
}
