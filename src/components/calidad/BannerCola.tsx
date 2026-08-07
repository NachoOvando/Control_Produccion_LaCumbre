"use client";

/**
 * Monta el indicador de cola una sola vez en la página de captura, en vez de
 * repetirlo en los siete formularios.
 *
 * Tiene su propia instancia de `useColaSincronizacion`, distinta de la que usa
 * `useBatchGuardar` para encolar. Las dos leen el MISMO object store de
 * IndexedDB, así que no hay dos colas ni riesgo de divergencia: lo único
 * duplicado es un tick de 30 s que hace un `count` — despreciable frente a
 * ensuciar siete formularios con el mismo bloque de UI.
 */

import { useColaSincronizacion } from "@/hooks/useColaSincronizacion";
import { IndicadorCola } from "@/components/calidad/IndicadorCola";

export function BannerCola() {
  const { estado, sincronizando, sincronizar } = useColaSincronizacion();
  return (
    <IndicadorCola
      estado={estado}
      sincronizando={sincronizando}
      onSincronizar={() => void sincronizar()}
    />
  );
}
