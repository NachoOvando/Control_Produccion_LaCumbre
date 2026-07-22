"use client";

import { useState } from "react";
import type {
  ProductoRow,
  MarcaRow,
  FamiliaRow,
  ParametroRow,
  BindingRow,
  EspecRow,
} from "@/types/maestro";
import { ProductosPanel } from "./ProductosPanel";
import { CatalogoPanel } from "./CatalogoPanel";

type Props = {
  productos: ProductoRow[];
  marcas: MarcaRow[];
  familias: FamiliaRow[];
  parametros: ParametroRow[];
  bindings: BindingRow[];
  especificaciones: EspecRow[];
};

type Tab = "productos" | "catalogo";

export function MaestroView(props: Props) {
  const [tab, setTab] = useState<Tab>("productos");

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <TabButton activo={tab === "productos"} onClick={() => setTab("productos")}>
          Productos ({props.productos.length})
        </TabButton>
        <TabButton activo={tab === "catalogo"} onClick={() => setTab("catalogo")}>
          Marcas y familias
        </TabButton>
      </div>

      {tab === "productos" ? (
        <ProductosPanel
          productos={props.productos}
          marcas={props.marcas}
          familias={props.familias}
          bindings={props.bindings}
          especificaciones={props.especificaciones}
        />
      ) : (
        <CatalogoPanel marcas={props.marcas} familias={props.familias} />
      )}
    </div>
  );
}

function TabButton({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
        activo ? "bg-[#E1000F] text-white shadow-sm" : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}
