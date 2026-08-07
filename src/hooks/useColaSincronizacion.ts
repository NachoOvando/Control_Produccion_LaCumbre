"use client";

/**
 * Adaptador de React sobre la cola offline. NO tiene lógica: todo lo que decide
 * qué se encola, en qué orden se sube y cuándo se reintenta vive en
 * `lib/offline/cola.ts`, que se testea sin montar React.
 *
 * Lo único que hace este hook es cablear los tres puertos, exponer el estado de
 * la cola para la UI, y decidir CUÁNDO disparar un drenado:
 *   - al montar (puede haber quedado algo de la sesión anterior),
 *   - cuando el navegador avisa que volvió la red,
 *   - cada 30 s como red de seguridad, porque el evento `online` de Android
 *     Chrome miente seguido: dispara con la interfaz asociada al AP pero sin
 *     salida real, cosa habitual con el WiFi de planta.
 */

import { useCallback, useEffect, useState } from "react";
import {
  drenar,
  encolar,
  estadoDeCola,
  type EstadoCola,
  type Dependencias,
} from "@/lib/offline/cola";
import { colaStoreIndexedDb } from "@/lib/offline/cola-store";
import { transporteHttp, relojSistema } from "@/lib/offline/transporte";
import type { RegistroPendiente } from "@/lib/offline/tipos";

const INTERVALO_DRENADO_MS = 30_000;

const ESTADO_VACIO: EstadoCola = {
  pendientes: 0,
  bloqueadas: 0,
  antiguedadMaximaMs: null,
  requiereAlerta: false,
};

export function useColaSincronizacion(deps?: Partial<Dependencias>) {
  const dependencias: Dependencias = {
    store: deps?.store ?? colaStoreIndexedDb,
    transporte: deps?.transporte ?? transporteHttp,
    reloj: deps?.reloj ?? relojSistema,
    generarId: deps?.generarId,
  };

  const [estado, setEstado] = useState<EstadoCola>(ESTADO_VACIO);
  const [sincronizando, setSincronizando] = useState(false);

  const refrescar = useCallback(async () => {
    const entradas = await dependencias.store.listar();
    setEstado(estadoDeCola(entradas, dependencias.reloj.ahora()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sincronizar = useCallback(async () => {
    setSincronizando(true);
    try {
      await drenar(dependencias);
    } finally {
      setSincronizando(false);
      await refrescar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refrescar]);

  const encolarMuestra = useCallback(
    async (registros: RegistroPendiente[]) => {
      const r = await encolar(registros, dependencias);
      await refrescar();
      return r;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refrescar]
  );

  useEffect(() => {
    void refrescar();
    void sincronizar();

    const alVolverLaRed = () => void sincronizar();
    window.addEventListener("online", alVolverLaRed);

    // Red de seguridad: el evento `online` no es confiable en Android Chrome
    // (dispara con la interfaz asociada al AP pero sin salida real). El tick
    // también mantiene fresca la antigüedad de la cola, que es lo que dispara la
    // alerta de los 60 minutos.
    const tick = setInterval(() => {
      void refrescar();
      void sincronizar();
    }, INTERVALO_DRENADO_MS);

    return () => {
      window.removeEventListener("online", alVolverLaRed);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { estado, sincronizando, sincronizar, encolarMuestra, refrescar };
}
