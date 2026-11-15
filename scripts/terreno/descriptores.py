"""Descriptores de terreno por ventana: relieve, pendiente y rugosidad.

Solo numpy, sin lectura de archivos, para poder probar el cálculo por separado.
Sigue la definición del backend (`prometheus_topography_plane_v1`): ventana cuadrada
en una malla métrica, relieve = máximo − mínimo, pendiente = media de la pendiente
local y rugosidad = RMS de los residuos respecto a un plano ajustado.
"""

import math

import numpy as np


def slope_degrees(z: np.ndarray, pixel_m: float) -> np.ndarray:
    """Pendiente local en grados con diferencias centrales de los 4 vecinos.

    La fila y la columna del borde quedan en NaN: no tienen vecinos a ambos lados.
    Un vecino sin dato deja el píxel en NaN; nunca se rellena.
    """
    out = np.full(z.shape, np.nan, dtype=np.float64)
    dz_dx = (z[1:-1, 2:] - z[1:-1, :-2]) / (2 * pixel_m)
    dz_dy = (z[2:, 1:-1] - z[:-2, 1:-1]) / (2 * pixel_m)
    out[1:-1, 1:-1] = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))
    return out


def plane_rms(z: np.ndarray, pixel_m: float) -> float:
    """RMS de los residuos respecto al plano z = a + bx + cy (mínimos cuadrados)."""
    rows, cols = np.nonzero(np.isfinite(z))
    values = z[rows, cols].astype(np.float64)
    x = cols * pixel_m
    y = rows * pixel_m
    design = np.column_stack([np.ones(values.size), x - x.mean(), y - y.mean()])
    coefficients, *_ = np.linalg.lstsq(design, values, rcond=None)
    residuals = values - design @ coefficients
    return float(np.sqrt(np.mean(residuals**2)))


def window_descriptors(z: np.ndarray, slope: np.ndarray, pixel_m: float, min_valid: float = 0.9):
    """Descriptores de una ventana, o None si le faltan demasiados datos."""
    valid = np.isfinite(z)
    if valid.mean() < min_valid or not np.isfinite(slope).any():
        return None
    return {
        "relief": float(np.nanmax(z) - np.nanmin(z)),
        "slope": float(np.nanmean(slope)),
        "roughness": plane_rms(z, pixel_m),
        "elevation": float(np.nanmean(z)),
    }


def tile_windows(z: np.ndarray, pixel_m: float, window_px: int, margin_px: int = 1, min_valid: float = 0.9):
    """Reparte la malla en ventanas contiguas y devuelve los descriptores de cada una.

    `z` trae `margin_px` píxeles extra por lado para que la pendiente del borde tenga vecinos.
    Devuelve (ventanas válidas, total de ventanas).
    """
    slope = slope_degrees(z, pixel_m)
    rows = (z.shape[0] - 2 * margin_px) // window_px
    cols = (z.shape[1] - 2 * margin_px) // window_px
    windows = []
    for r in range(rows):
        for c in range(cols):
            r0 = margin_px + r * window_px
            c0 = margin_px + c * window_px
            block = (slice(r0, r0 + window_px), slice(c0, c0 + window_px))
            result = window_descriptors(z[block], slope[block], pixel_m, min_valid)
            if result:
                windows.append(result)
    return windows, rows * cols


def summarize(windows: list[dict], key: str) -> dict:
    """Mediana y cuartiles de un descriptor entre las ventanas de un área."""
    values = np.array([w[key] for w in windows], dtype=np.float64)
    q1, median, q3 = np.percentile(values, [25, 50, 75])
    return {"median": float(median), "q1": float(q1), "q3": float(q3)}


def profile(windows: list[dict], min_windows: int) -> dict:
    """Mediana y cuartiles de cada descriptor; None si hay muy pocas ventanas."""
    if len(windows) < min_windows:
        return {"relief": None, "slope": None, "roughness": None, "elevation": None}

    def stats(key, digits):
        return {name: round(value, digits) for name, value in summarize(windows, key).items()}

    return {
        "relief": stats("relief", 0),
        "slope": stats("slope", 1),
        "roughness": stats("roughness", 1),
        "elevation": round(float(np.median([w["elevation"] for w in windows]))),
    }


def coarsen(z: np.ndarray, factor: int) -> np.ndarray:
    """Promedia bloques de `factor` × `factor` píxeles. Un bloque con algún hueco queda sin dato."""
    rows = z.shape[0] // factor
    cols = z.shape[1] // factor
    blocks = z[: rows * factor, : cols * factor].reshape(rows, factor, cols, factor)
    return blocks.mean(axis=(1, 3))


def hillshade(elevation: np.ndarray, pixel_m: float, azimuth=315.0, altitude=45.0) -> np.ndarray:
    """Relieve sombreado, 0–1, con la luz desde arriba a la izquierda."""
    dz_dy, dz_dx = np.gradient(elevation, pixel_m)
    dz_dy = -dz_dy  # las filas bajan; el norte de la malla queda arriba
    az, alt = math.radians(azimuth), math.radians(altitude)
    light = (math.cos(alt) * math.sin(az), math.cos(alt) * math.cos(az), math.sin(alt))
    norm = np.sqrt(dz_dx**2 + dz_dy**2 + 1)
    return np.clip((-dz_dx * light[0] - dz_dy * light[1] + light[2]) / norm, 0, 1)
