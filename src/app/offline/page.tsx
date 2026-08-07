/**
 * Pantalla de fallback cuando el operario abre la app sin red y la ruta que pidió
 * no está en el precache del service worker.
 *
 * Tiene que ser estática (sin `force-dynamic`, sin queries): es justamente la
 * página que se sirve desde el caché cuando no hay servidor al que preguntarle
 * nada.
 *
 * El mensaje no dice "error". Para un operario de planta, que la red se caiga es
 * una condición normal del turno, no una falla del sistema — y lo importante que
 * tiene que saber es lo que NO es obvio: que lo que ya cargó no se perdió.
 */

export const metadata = {
  title: "Sin conexión — Control de Producción",
};

export default function OfflinePage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-gray-50">
      <div className="max-w-sm w-full text-center space-y-5">
        <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-amber-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 5.636a9 9 0 010 12.728m-12.728 0a9 9 0 010-12.728m9.9 9.9a5 5 0 010-7.072m-7.072 0a5 5 0 010 7.072M12 12h.01"
            />
          </svg>
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold text-gray-900">Sin conexión</h1>
          <p className="text-sm text-gray-600 leading-relaxed">
            La tablet no llega al servidor. Puede ser el WiFi de planta.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-4 text-left space-y-2">
          <p className="text-sm font-semibold text-gray-800">
            Las muestras que ya cargaste no se perdieron
          </p>
          <p className="text-xs text-gray-600 leading-relaxed">
            Quedaron guardadas en la tablet y se suben solas cuando vuelva la red.
            No cierres la aplicación ni borres datos del navegador.
          </p>
        </div>

        {/* Recarga real, no router.push: sin red el router de Next no puede
            resolver la navegación, y un reload sí vuelve a intentar la request
            original (que es lo que el operario espera del botón). */}
        <a
          href="/calidad"
          className="block w-full py-3.5 rounded-xl bg-[#E1000F] text-white text-sm font-bold active:scale-95 transition-transform"
        >
          Reintentar
        </a>

        <p className="text-xs text-gray-400 leading-relaxed">
          Si sigue sin conexión después de un rato, avisá a supervisión: los
          registros pendientes tienen que subir antes del cierre del turno.
        </p>
      </div>
    </main>
  );
}
