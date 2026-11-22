/**
 * Detector de manos y gestos (MediaPipe, de Google), cargado solo cuando alguien enciende el
 * control por gestos. Todo corre en el navegador: la imagen de la cámara no sale del equipo.
 *
 * - El motor (WebAssembly) se sirve desde `mediapipe/wasm/` (lo copia Vite desde el paquete de npm).
 * - El modelo es `mediapipe/gesture_recognizer.task`: localiza los 21 puntos de cada mano y
 *   clasifica gestos comunes (mano abierta, puño, dos dedos, señalar).
 */
import type { GestureRecognizer } from "@mediapipe/tasks-vision";

const BASE = import.meta.env?.BASE_URL ?? "/";

let recognizer: Promise<GestureRecognizer> | null = null;

/** El detector, creado una sola vez. Con tarjeta gráfica si se puede; si no, con el procesador. */
export function loadRecognizer(): Promise<GestureRecognizer> {
  recognizer ??= (async () => {
    const { FilesetResolver, GestureRecognizer } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`);
    const create = (delegate: "GPU" | "CPU") =>
      GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}mediapipe/gesture_recognizer.task`, delegate },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    try {
      return await create("GPU");
    } catch {
      return create("CPU");
    }
  })();
  // Si falla (sin red, archivo dañado), el siguiente intento empieza de cero.
  recognizer.catch(() => {
    recognizer = null;
  });
  return recognizer;
}
