import emblemColor from "../assets/marca/emblema-color.webp";
import emblemWhite from "../assets/marca/emblema-blanco.webp";

interface Props {
  /**
   * Sobre qué va la marca. `oscuro`: fondos oscuros y la barra azul, con el emblema blanco.
   * `claro`: tarjetas blancas, con el emblema a color.
   */
  surface?: "oscuro" | "claro";
  /** Texto para lectores de pantalla: a dónde lleva el enlace. */
  label: string;
}

/**
 * La marca de PROMETHEUS: el emblema del logotipo y el nombre. Enlaza a la portada.
 * Los archivos del logotipo están en `src/assets/marca/`.
 */
export function Brand({ surface = "oscuro", label }: Props) {
  return (
    <a className="brand" href="#inicio" aria-label={label}>
      <img className="brand-logo" src={surface === "claro" ? emblemColor : emblemWhite} alt="" width={256} height={246} />
      <div>
        PROMETHEUS<small>BY VELKARIS</small>
      </div>
    </a>
  );
}
