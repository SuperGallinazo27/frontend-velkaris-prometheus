# Modelos 3D de los robots

El simulador («Prueba del robot») dibuja Perseverance y Curiosity con los **modelos 3D oficiales de NASA**. Están en `public/modelos/` como copias aligeradas por `aligerar.py`.

| Archivo | Original de NASA | Peso original | Peso aquí |
| --- | --- | --- | --- |
| `public/modelos/perseverance.glb` | https://assets.science.nasa.gov/content/dam/science/psd/mars/resources/gltf_files/25042_Perseverance.glb | 11,7 MB | 7,0 MB |
| `public/modelos/curiosity.glb` | https://assets.science.nasa.gov/content/dam/science/psd/mars/resources/gltf_files/24584_Curiosity_static.glb | 11,9 MB | 2,7 MB |

Páginas de los modelos: [Perseverance](https://science.nasa.gov/resource/mars-perseverance-rover-3d-model/) y [Curiosity](https://science.nasa.gov/resource/curiosity-rover-3d-model/).

**Crédito:** Cortesía de NASA/JPL-Caltech. Usar sus modelos no significa que NASA respalde este proyecto, y no se usan sus logotipos. Normas de uso: https://www.nasa.gov/nasa-brand-center/images-and-media/

VIPER y el carro lunar del Apolo no tienen modelo oficial: se dibujan con formas simples en `src/features/mission/robotModels.ts`, a las medidas publicadas.

## Qué hace `aligerar.py`

No cambia la forma: las posiciones y los triángulos son los del original, vértice a vértice.

- Guarda las normales en 8 bits y las coordenadas de textura en 16 bits (extensión estándar `KHR_mesh_quantization`, que Three.js lee sin nada más).
- Quita las coordenadas de textura que ningún material usa.
- Pasa a JPEG las imágenes PNG que no tienen transparencia y junta las repetidas.
- Reduce las imágenes a 768 px (color) y 512 px (normales y rugosidad).

```bash
python -I scripts/modelos/aligerar.py RUTA/25042_Perseverance.glb public/modelos/perseverance.glb
python -I scripts/modelos/aligerar.py RUTA/24584_Curiosity_static.glb public/modelos/curiosity.glb
```

Necesita numpy y pillow (`scripts/terreno/requirements.txt`).

## Medidas tomadas de los modelos

Los modelos están en metros, a tamaño real. De ellos salen dos datos que NASA no publica en texto y que `wheelData.ts` cita como «medido en el modelo 3D oficial»:

- **Ancho de la rueda de Perseverance:** 33,6 cm. El diámetro del modelo, 52,5 cm, coincide con el publicado.
- **Posición de las ruedas** (para dibujar las huellas y apoyar el robot): 2,26 m entre el eje delantero y el trasero en los dos robots; 2,12 m entre ruedas izquierdas y derechas en Perseverance y 2,13 m en Curiosity.

En el modelo de Curiosity la rueda mide 48,5 cm de diámetro y 39,5 cm de ancho. El cálculo usa lo que publica NASA JPL: 50 cm y 40 cm.

En los dos modelos las seis ruedas vienen fundidas en una sola pieza. Al cargarlos, el simulador las separa por su posición para que cada una gire sobre su eje.
