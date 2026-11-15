"""Pruebas del cálculo. Ejecutar con: python -m unittest discover scripts/terreno"""

import math
import unittest

import numpy as np

from descriptores import plane_rms, slope_degrees, summarize, tile_windows, window_descriptors

PIXEL = 30.0


def plane(rows, cols, dz_dx=0.0, dz_dy=0.0, base=100.0):
    y, x = np.mgrid[0:rows, 0:cols]
    return base + dz_dx * x * PIXEL + dz_dy * y * PIXEL


class Pendiente(unittest.TestCase):
    def test_plano_inclinado_da_su_angulo(self):
        z = plane(20, 20, dz_dx=math.tan(math.radians(10)))
        slope = slope_degrees(z, PIXEL)
        self.assertTrue(np.allclose(slope[1:-1, 1:-1], 10.0))
        self.assertTrue(np.isnan(slope[0]).all() and np.isnan(slope[:, -1]).all())

    def test_combina_las_dos_direcciones(self):
        z = plane(10, 10, dz_dx=0.3, dz_dy=0.4)
        self.assertAlmostEqual(float(slope_degrees(z, PIXEL)[5, 5]), math.degrees(math.atan(0.5)))

    def test_un_vecino_sin_dato_no_se_rellena(self):
        z = plane(10, 10, dz_dx=0.1)
        z[5, 5] = np.nan
        slope = slope_degrees(z, PIXEL)
        self.assertTrue(np.isnan(slope[5, 4]) and np.isnan(slope[4, 5]))
        self.assertFalse(np.isnan(slope[3, 3]))


class Rugosidad(unittest.TestCase):
    def test_un_plano_no_tiene_rugosidad(self):
        self.assertAlmostEqual(plane_rms(plane(30, 30, 0.2, -0.1), PIXEL), 0.0, places=6)

    def test_mide_la_ondulacion_sobre_el_plano(self):
        rng = np.random.default_rng(7)
        bumps = rng.normal(0, 5, (100, 100))
        z = plane(100, 100, 0.05, 0.02) + bumps
        self.assertAlmostEqual(plane_rms(z, PIXEL), 5.0, delta=0.15)

    def test_ignora_los_huecos(self):
        z = plane(30, 30, 0.2, 0.1)
        z[10:12, 10:12] = np.nan
        self.assertAlmostEqual(plane_rms(z, PIXEL), 0.0, places=6)


class Ventanas(unittest.TestCase):
    def test_relieve_es_maximo_menos_minimo(self):
        z = plane(12, 12)
        z[4, 4] = 150.0
        z[8, 8] = 90.0
        result = window_descriptors(z, slope_degrees(z, PIXEL), PIXEL)
        self.assertAlmostEqual(result["relief"], 60.0)

    def test_descarta_ventanas_con_pocos_datos(self):
        z = plane(12, 12)
        z[:, :3] = np.nan
        self.assertIsNone(window_descriptors(z, slope_degrees(z, PIXEL), PIXEL))

    def test_reparte_la_malla_con_margen(self):
        z = plane(2 * 10 + 2, 3 * 10 + 2, dz_dx=math.tan(math.radians(5)))
        windows, total = tile_windows(z, PIXEL, window_px=10)
        self.assertEqual(total, 6)
        self.assertEqual(len(windows), 6)
        for w in windows:
            self.assertAlmostEqual(w["slope"], 5.0, places=6)
            self.assertAlmostEqual(w["roughness"], 0.0, places=6)

    def test_una_ventana_sobre_agua_no_cuenta(self):
        z = plane(10 + 2, 20 + 2)
        z[:, 11:] = np.nan
        windows, total = tile_windows(z, PIXEL, window_px=10)
        self.assertEqual((len(windows), total), (1, 2))

    def test_resumen_con_mediana_y_cuartiles(self):
        stats = summarize([{"relief": v} for v in (1, 2, 3, 4, 5)], "relief")
        self.assertEqual(stats, {"median": 3.0, "q1": 2.0, "q3": 4.0})


if __name__ == "__main__":
    unittest.main()
