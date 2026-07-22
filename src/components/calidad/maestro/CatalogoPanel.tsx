"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MarcaRow, FamiliaRow, LineaNegocio } from "@/types/maestro";

const inputCls =
  "w-full py-2.5 px-3 rounded-xl border-2 border-gray-200 bg-gray-50 text-sm text-gray-900 focus:border-[#E1000F] focus:outline-none";

const LINEA_LABEL: Record<LineaNegocio, string> = {
  marca_propia: "Marca propia",
  copacker_arcor: "Copacker Arcor",
  fason_terceros: "Fasón / terceros",
};

export function CatalogoPanel({ marcas, familias }: { marcas: MarcaRow[]; familias: FamiliaRow[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <MarcasCard marcas={marcas} />
      <FamiliasCard familias={familias} />
    </div>
  );
}

function MarcasCard({ marcas }: { marcas: MarcaRow[] }) {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [lineaNegocio, setLineaNegocio] = useState<LineaNegocio>("fason_terceros");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crear = async () => {
    if (!nombre.trim()) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/calidad/maestro/marcas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim(), lineaNegocio }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Error");
        return;
      }
      setNombre("");
      router.refresh();
    } catch {
      setError("Error de conexión");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Marcas ({marcas.length})</p>
      </div>
      <ul className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
        {marcas.map((m) => (
          <li key={m.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-800 truncate">{m.nombre}</span>
            <span className="text-[11px] text-gray-400 whitespace-nowrap">{LINEA_LABEL[m.lineaNegocio]}</span>
          </li>
        ))}
      </ul>
      <div className="p-3 border-t border-gray-100 space-y-2">
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre de la marca"
          className={inputCls}
        />
        <select value={lineaNegocio} onChange={(e) => setLineaNegocio(e.target.value as LineaNegocio)} className={inputCls}>
          <option value="marca_propia">Marca propia</option>
          <option value="copacker_arcor">Copacker Arcor</option>
          <option value="fason_terceros">Fasón / terceros</option>
        </select>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          type="button"
          onClick={crear}
          disabled={enviando}
          className="w-full py-2.5 rounded-xl text-sm font-bold text-white bg-[#E1000F] hover:bg-[#c0000d] active:scale-95 disabled:opacity-50 transition-all"
        >
          {enviando ? "Creando…" : "+ Agregar marca"}
        </button>
      </div>
    </div>
  );
}

function FamiliasCard({ familias }: { familias: FamiliaRow[] }) {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTocado, setSlugTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Autoslug desde el nombre salvo que el usuario lo edite a mano.
  const autoslug = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // quita diacríticos (á → a)
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  const crear = async () => {
    const slugFinal = slugTocado ? slug.trim() : autoslug(nombre);
    if (!nombre.trim() || !slugFinal) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/calidad/maestro/familias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim(), slug: slugFinal }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Error");
        return;
      }
      setNombre("");
      setSlug("");
      setSlugTocado(false);
      router.refresh();
    } catch {
      setError("Error de conexión");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Familias ({familias.length})</p>
      </div>
      <ul className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
        {familias.map((f) => (
          <li key={f.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-800 truncate">{f.nombre}</span>
            <span className="text-[11px] text-gray-400 font-mono whitespace-nowrap">{f.slug}</span>
          </li>
        ))}
      </ul>
      <div className="p-3 border-t border-gray-100 space-y-2">
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre de la familia"
          className={inputCls}
        />
        <input
          type="text"
          value={slugTocado ? slug : autoslug(nombre)}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugTocado(true);
          }}
          placeholder="slug (auto)"
          className={inputCls + " font-mono text-xs"}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          type="button"
          onClick={crear}
          disabled={enviando}
          className="w-full py-2.5 rounded-xl text-sm font-bold text-white bg-[#E1000F] hover:bg-[#c0000d] active:scale-95 disabled:opacity-50 transition-all"
        >
          {enviando ? "Creando…" : "+ Agregar familia"}
        </button>
      </div>
    </div>
  );
}
