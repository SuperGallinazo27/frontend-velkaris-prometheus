import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { readHand } from "./gestures";
import type { HandReading } from "./gestures";
import { loadRecognizer } from "./tracker";
import "./gestos.css";

type Status = "camara" | "detector" | "listo" | "error";

interface Props {
  /** Las manos que se ven en cada imagen analizada (lista vacía si no hay ninguna). */
  onHands: (hands: HandReading[], now: number) => void;
  /** Se llama al apagar la cámara por un error, para que quien la usa suelte los mandos. */
  onStop?: () => void;
  /** Texto bajo la imagen: qué gesto se está leyendo. */
  children?: ReactNode;
}

/** Huesos de la mano, para dibujarla sobre la imagen. */
const BONES: readonly [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/** Como mucho, tantas lecturas por segundo: de sobra para conducir y deja aire a la escena 3D. */
const MAX_READS_PER_SECOND = 24;

const MESSAGES: Record<string, string> = {
  NotAllowedError: "Falta el permiso de la cámara. Pulsa el candado de la barra de direcciones, permite la cámara y vuelve a encenderla.",
  NotFoundError: "No se encontró ninguna cámara conectada.",
  NotReadableError: "Otra aplicación está usando la cámara. Ciérrala y vuelve a intentarlo.",
  OverconstrainedError: "La cámara no admite la imagen pedida.",
};

/**
 * Cámara con detector de manos: enciende la cámara, lee los gestos y enseña una vista pequeña,
 * como un espejo, con la mano dibujada encima para que se vea qué entiende el detector.
 * La imagen se analiza en el navegador y se descarta: no se graba ni se envía a ningún sitio.
 */
export function GestureCamera({ onHands, onStop, children }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onHandsRef = useRef(onHands);
  const onStopRef = useRef(onStop);
  const [status, setStatus] = useState<Status>("camara");
  const [error, setError] = useState("");

  useEffect(() => {
    onHandsRef.current = onHands;
    onStopRef.current = onStop;
  });

  useEffect(() => {
    let stopped = false;
    let frame = 0;
    let stream: MediaStream | null = null;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new DOMException("La cámara solo funciona en una dirección segura (https) o en localhost.", "SecurityError");
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setStatus("detector");
        const recognizer = await loadRecognizer();
        if (stopped) return;
        setStatus("listo");

        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d")!;
        let lastVideoTime = -1;
        let lastRead = 0;

        const loop = () => {
          if (stopped) return;
          frame = requestAnimationFrame(loop);
          if (document.hidden || video.readyState < 2 || !video.videoWidth) return;
          const now = performance.now();
          // MediaPipe pide una imagen nueva y un tiempo que siempre crezca.
          if (video.currentTime === lastVideoTime || now - lastRead < 1000 / MAX_READS_PER_SECOND) return;
          lastVideoTime = video.currentTime;
          lastRead = now;
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
          const result = recognizer.recognizeForVideo(video, now);
          const aspect = video.videoWidth / video.videoHeight;
          const hands: HandReading[] = [];
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          result.landmarks.forEach((image, index) => {
            const top = result.gestures[index]?.[0];
            const reading = readHand(image, result.worldLandmarks[index] ?? [], aspect, top ? { name: top.categoryName, score: top.score } : null);
            if (!reading) return;
            hands.push(reading);
            drawHand(ctx, image, canvas.width, canvas.height, reading.pose !== "otra");
          });
          onHandsRef.current(hands, now);
        };
        loop();
      } catch (cause) {
        if (stopped) return;
        const name = (cause as DOMException | undefined)?.name ?? "";
        setError(
          MESSAGES[name] ??
            (name === "SecurityError"
              ? "La cámara solo funciona en una dirección segura (https) o en localhost."
              : "No se pudo encender la cámara o cargar el detector de manos. Revisa la conexión y vuelve a intentarlo."),
        );
        setStatus("error");
        onStopRef.current?.();
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      // Sin cámara no hay manos: quien conduce con ellas se detiene.
      onHandsRef.current([], performance.now());
    };
  }, []);

  return (
    <div className="gestos-camara" data-estado={status}>
      <div className="gestos-espejo">
        {/* La imagen y el dibujo van espejados con CSS: quien se mira se ve como en un espejo. */}
        <video ref={videoRef} playsInline muted aria-label="Imagen de tu cámara, como en un espejo" />
        <canvas ref={canvasRef} aria-hidden="true" />
        {status !== "listo" && (
          <p className={status === "error" ? "gestos-aviso error" : "gestos-aviso"} role={status === "error" ? "alert" : "status"}>
            {status === "camara" ? "Encendiendo la cámara…" : status === "detector" ? "Cargando el detector de manos…" : error}
          </p>
        )}
      </div>
      {status === "listo" && children}
      <p className="gestos-privado">La imagen se analiza en tu equipo: no se graba ni se envía.</p>
    </div>
  );
}

function drawHand(ctx: CanvasRenderingContext2D, points: readonly { x: number; y: number }[], width: number, height: number, known: boolean) {
  const color = known ? "#7fd6c4" : "#ec9b72";
  ctx.lineWidth = Math.max(2, width / 220);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const [a, b] of BONES) {
    ctx.moveTo(points[a].x * width, points[a].y * height);
    ctx.lineTo(points[b].x * width, points[b].y * height);
  }
  ctx.stroke();
  for (const point of points) {
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, Math.max(2.5, width / 180), 0, Math.PI * 2);
    ctx.fill();
  }
}
