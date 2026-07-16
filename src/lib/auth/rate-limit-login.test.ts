import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_INTENTOS_EMAIL,
  UMBRAL_SOSPECHA_IP,
  VENTANA_BLOQUEO_MS,
  limpiarFallosDeEmail,
  loginBloqueado,
  registrarFalloLogin,
  resetRateLimitLogin,
} from "./rate-limit-login";

const T0 = 1_000_000; // instante base arbitrario — el módulo acepta `ahora` inyectado

describe("rate limiting de login", () => {
  beforeEach(() => {
    resetRateLimitLogin();
  });

  it("no bloquea sin fallos previos", () => {
    expect(loginBloqueado("a@x.com", T0)).toBe(false);
  });

  it("bloquea el email al llegar a MAX_INTENTOS_EMAIL fallos, con flag de transición solo en el fallo exacto", () => {
    for (let i = 0; i < MAX_INTENTOS_EMAIL - 1; i++) {
      const r = registrarFalloLogin("a@x.com", "10.0.0.1", T0 + i);
      expect(r.emailBloqueado).toBe(false);
      expect(loginBloqueado("a@x.com", T0 + i)).toBe(false);
    }
    const transicion = registrarFalloLogin("a@x.com", "10.0.0.1", T0);
    expect(transicion.emailBloqueado).toBe(true);
    expect(loginBloqueado("a@x.com", T0)).toBe(true);
    // Fallos posteriores al umbral NO repiten el flag (el log no se floodea).
    const posterior = registrarFalloLogin("a@x.com", "10.0.0.1", T0);
    expect(posterior.emailBloqueado).toBe(false);
  });

  it("el bloqueo por email expira al vencer la ventana", () => {
    for (let i = 0; i < MAX_INTENTOS_EMAIL; i++) {
      registrarFalloLogin("a@x.com", "10.0.0.1", T0);
    }
    expect(loginBloqueado("a@x.com", T0 + VENTANA_BLOQUEO_MS)).toBe(true);
    expect(loginBloqueado("a@x.com", T0 + VENTANA_BLOQUEO_MS + 1)).toBe(false);
  });

  it("bloquear un email no afecta a otro email", () => {
    for (let i = 0; i < MAX_INTENTOS_EMAIL; i++) {
      registrarFalloLogin("victima@x.com", "10.0.0.66", T0);
    }
    expect(loginBloqueado("victima@x.com", T0)).toBe(true);
    expect(loginBloqueado("otro@x.com", T0)).toBe(false);
  });

  it("la IP sospechosa se marca al cruzar el umbral pero NUNCA bloquea logins", () => {
    let sospechas = 0;
    for (let i = 0; i < UMBRAL_SOSPECHA_IP + 5; i++) {
      const r = registrarFalloLogin(`spray-${i}@x.com`, "10.0.0.66", T0);
      if (r.ipSospechosa) sospechas++;
    }
    // La transición se marca exactamente una vez por ventana.
    expect(sospechas).toBe(1);
    // Ningún email individual llegó a su límite: nadie queda bloqueado,
    // aunque la IP haya superado su umbral (solo detección).
    expect(loginBloqueado("spray-nuevo@x.com", T0)).toBe(false);
    expect(loginBloqueado("spray-0@x.com", T0)).toBe(false);
  });

  it("un login exitoso limpia el contador del email pero NO el de la IP", () => {
    for (let i = 0; i < MAX_INTENTOS_EMAIL; i++) {
      registrarFalloLogin("a@x.com", "10.0.0.66", T0);
    }
    expect(loginBloqueado("a@x.com", T0)).toBe(true);
    limpiarFallosDeEmail("a@x.com");
    expect(loginBloqueado("a@x.com", T0)).toBe(false);
    // El contador de IP sigue acumulando: el próximo fallo desde esa IP
    // parte de los 5 previos, no de cero.
    let r = registrarFalloLogin("b@x.com", "10.0.0.66", T0);
    for (let i = 0; i < UMBRAL_SOSPECHA_IP - MAX_INTENTOS_EMAIL - 2; i++) {
      r = registrarFalloLogin(`c-${i}@x.com`, "10.0.0.66", T0);
    }
    r = registrarFalloLogin("d@x.com", "10.0.0.66", T0);
    expect(r.ipSospechosa).toBe(true);
  });

  it("fallos fuera de la ventana reinician el contador en vez de acumular", () => {
    for (let i = 0; i < MAX_INTENTOS_EMAIL - 1; i++) {
      registrarFalloLogin("a@x.com", "10.0.0.1", T0);
    }
    // El siguiente fallo llega con la ventana vencida: arranca contador nuevo.
    const T1 = T0 + VENTANA_BLOQUEO_MS + 1;
    const r = registrarFalloLogin("a@x.com", "10.0.0.1", T1);
    expect(r.emailBloqueado).toBe(false);
    expect(loginBloqueado("a@x.com", T1)).toBe(false);
  });
});
