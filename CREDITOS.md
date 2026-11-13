# Créditos y licencias de recursos — Timber Rush 3D

## Modelos 3D

### Low-Poly Nature Starter Pack
- **Autor:** ventureoperations44
- **Fuente:** https://ventureoperations44.itch.io/low-poly-nature-starter-pack
- **Licencia:** CC0 1.0 (dominio público)
- **Archivos usados:** `public/assets/models/nature_*.glb`
  - Árboles: `nature_tree_pine_01–03`, `nature_tree_deciduous_01–03`
  - Rocas: `nature_rock_01–08`
  - Vegetación: `nature_bush_01–03`, `nature_grass_01–03`, `nature_flower_01–04`
  - Troncos: `nature_log_01–02`
- **Modificaciones en tiempo de ejecución:** los modelos no incluyen materiales; el juego
  les asigna un `MeshStandardMaterial` propio con colores de vértice, convierte esos
  colores de sRGB a espacio lineal y calcula normales. Los archivos originales no se modifican.

### Ultimate Modular Men Pack (personaje Worker)
- **Autor:** Quaternius
- **Fuente:** https://quaternius.com/packs/ultimatemodularcharacters.html
- **Licencia:** CC0 1.0 (dominio público). Verificada en la página oficial del paquete y en
  https://quaternius.com/faq.html (la descarga no incluye archivo de licencia).
- **Uso previsto:** `Worker` como personaje base, con sus animaciones Idle, Walk y Run.
  Los 11 personajes comparten el esqueleto `CharacterArmature`, lo que permite
  intercambiar piezas de ropa en el futuro.

### Universal Animation Library 2 — Standard
- **Autor:** Quaternius
- **Fuente:** https://quaternius.com/packs/universalanimationlibrary2.html
- **Licencia:** CC0 1.0 (dominio público). Verificada en el `License.txt` incluido en la descarga.
- **Uso previsto:** animación `TreeChopping_Loop` (archivo sin root motion `UAL2_Standard.glb`),
  adaptada con Blender al esqueleto del Worker (retargeting previo, no en tiempo de ejecución).

### Archivo generado: `public/assets/models/worker.glb`
- Worker (Ultimate Modular Men Pack) con sus animaciones Idle, Walk y Run + `TreeChopping_Loop`
  de UAL2 adaptada a su esqueleto. Generado con `herramientas/retarget_worker.py` (Blender 5.2.0).
  Ambos orígenes son CC0.

### Personaje anterior (ya no se usa)
- **Autor:** Quaternius · **Archivo:** `public/assets/models/lumberjack.glb`
- Sustituido por el Worker en la Fase 5. Se conserva hasta confirmar el cambio visualmente.

## Bibliotecas
- Three.js (MIT) · cannon-es (MIT) · Appwrite Web SDK (BSD-3-Clause) · Vite (MIT)
