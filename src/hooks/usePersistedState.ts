"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * useState con espejo en sessionStorage. `key === null` desactiva la
 * persistencia (útil si algún dato necesario para armar la key todavía no
 * está disponible). Si el storage tiene JSON corrupto o de un shape viejo,
 * se descarta y se usa el valor inicial — nunca debe romper el render.
 *
 * La restauración ocurre en un `useEffect` (después de la hidratación), NO en
 * el inicializador de `useState`: sessionStorage no existe en el render de
 * servidor, así que leerlo ahí haría que el primer render de cliente
 * (hidratación) no coincida con el HTML del servidor — React descarta el árbol
 * completo y lo vuelve a montar desde cero (flash visible, warning de
 * hidratación en consola).
 *
 * `restaurado` es estado (no un ref): el efecto que escribe en sessionStorage
 * debe esperar a que el `setState` de la restauración se refleje en un render
 * real antes de escribir — si dependiera de un ref mutado sincrónicamente,
 * ambos efectos corren en la misma pasada (el de escribir usa el `state`
 * todavía viejo, previo a la restauración) y el valor recién restaurado se
 * pisa con el valor inicial antes de que el operario llegue a verlo. Con
 * `restaurado` como estado, `setState(parsed)` + `setRestaurado(true)` se
 * aplican juntos en el mismo commit — el efecto de escritura solo corre
 * después de ese commit, ya con el valor correcto.
 */
export function usePersistedState<T>(
  key: string | null,
  initial: T | (() => T)
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const [state, setState] = useState<T>(initial);
  const [restaurado, setRestaurado] = useState(false);

  useEffect(() => {
    if (!key) {
      setRestaurado(true);
      return;
    }
    try {
      const raw = sessionStorage.getItem(key);
      if (raw !== null) setState(JSON.parse(raw) as T);
    } catch {
      // JSON corrupto o de un shape viejo — se ignora, sigue con el valor inicial.
    }
    setRestaurado(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (typeof window === "undefined" || !key || !restaurado) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Storage lleno o deshabilitado (modo privado) — no bloquear la carga.
    }
  }, [key, state, restaurado]);

  const limpiar = () => {
    if (typeof window !== "undefined" && key) sessionStorage.removeItem(key);
  };

  return [state, setState, limpiar];
}
