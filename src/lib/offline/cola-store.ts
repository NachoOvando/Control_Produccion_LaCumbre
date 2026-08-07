"use client";

/**
 * Implementación del puerto `ColaStore` sobre IndexedDB, vía `idb`.
 *
 * Por qué IndexedDB y no `sessionStorage`/`localStorage`:
 *   - `sessionStorage` se borra al cerrar la pestaña, y cerrar la pestaña es
 *     exactamente lo que un operario hace cuando "no funciona". Se sigue usando
 *     para el BORRADOR mientras se tipea (ver usePersistedState), que es otra
 *     cosa: efímero y sincrónico.
 *   - `localStorage` es sincrónico y bloquea el hilo principal, y tiene un tope
 *     bajo (~5 MB) compartido con todo el origen.
 *   - IndexedDB es la única opción durable con budget razonable en Android
 *     Chrome, que es el dispositivo de planta (D7).
 *
 * Por qué `idb` y no Dexie ni IndexedDB crudo: `idb` son ~1,2 kB y solo
 * promisifica la API nativa. Dexie trae ~25 kB más su propio sistema de
 * migraciones y queries, que para UN object store es dependencia sin ganancia.
 * IndexedDB crudo son 200 líneas de callbacks que nadie va a querer tocar.
 *
 * Este módulo es un ADAPTADOR: no tiene ninguna decisión de política. Todo lo que
 * decide qué se encola, en qué orden y cuándo se reintenta vive en `cola.ts`,
 * que no importa IndexedDB y por eso se testea sin navegador.
 */

import { openDB, type IDBPDatabase } from "idb";
import type { ColaStore, EntradaCola } from "./tipos";

const NOMBRE_DB = "calidad-offline";
const VERSION_DB = 1;
const STORE = "cola_registros";

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(NOMBRE_DB, VERSION_DB, {
      upgrade(base) {
        if (!base.objectStoreNames.contains(STORE)) {
          const store = base.createObjectStore(STORE, { keyPath: "id" });
          // Índice por instante de captura: el orden de sincronización es por
          // captura, no por encolado (ver ordenarParaEnviar en cola.ts).
          store.createIndex("capturadoEn", "capturadoEn");
        }
      },
    });
  }
  return dbPromise;
}

/**
 * ¿Hay IndexedDB usable? En modo privado de algunos navegadores `indexedDB`
 * existe pero abrir la base falla. Se chequea la existencia acá y el fallo real
 * se maneja en cada operación: la captura NUNCA debe romperse porque el storage
 * no esté disponible.
 */
export function indexedDbDisponible(): boolean {
  return typeof indexedDB !== "undefined";
}

export const colaStoreIndexedDb: ColaStore = {
  async listar() {
    if (!indexedDbDisponible()) return [];
    try {
      const base = await db();
      return (await base.getAll(STORE)) as EntradaCola[];
    } catch (e) {
      console.error("[cola-store] no se pudo listar la cola:", e);
      return [];
    }
  },

  async guardar(entrada: EntradaCola) {
    if (!indexedDbDisponible()) {
      // Se propaga a propósito: el llamador tiene que poder decirle al operario
      // que la muestra NO quedó guardada. Fallar en silencio acá sería la peor
      // opción posible — el operario cerraría la pantalla creyendo que subió.
      throw new Error("Almacenamiento local no disponible en este dispositivo");
    }
    const base = await db();
    await base.put(STORE, entrada);
  },

  async borrar(id: string) {
    if (!indexedDbDisponible()) return;
    try {
      const base = await db();
      await base.delete(STORE, id);
    } catch (e) {
      // Una entrada que no se pudo borrar se va a reintentar, y el servidor la
      // va a reconocer por su clientRequestId sin duplicarla. Es el modo de
      // falla benigno de tener idempotencia.
      console.error("[cola-store] no se pudo borrar la entrada", id, e);
    }
  },

  async contar() {
    if (!indexedDbDisponible()) return 0;
    try {
      const base = await db();
      return await base.count(STORE);
    } catch {
      return 0;
    }
  },
};
