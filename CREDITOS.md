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

### Low Poly Lumber Mill Pack (evolución del aserradero)
- **Autor:** reodesuxz
- **Licencia:** la incluida en el paquete (`LICENSE.txt`, verificada antes de integrarlo):
  permite *«Use in unlimited personal and commercial projects (games, apps, films, renders,
  prototypes)»* y *«Modify the assets for use in your projects»*; prohíbe *«redistributing the
  asset files, modified or unmodified, as standalone assets or as part of another asset pack
  or library»*.
- **Cumplimiento:** los archivos originales del paquete NO están en el repositorio ni en
  `public/` (siguen en `recursos-originales/`, ignorado por git). El juego solo incluye
  `public/assets/models/aserradero.glb`, un archivo propio generado con
  `herramientas/preparar_aserradero.py` (Blender 5.2.0) que contiene únicamente los 22 modelos
  usados, ya adaptados al juego (no es un paquete de recursos reutilizable):
  - colores de los materiales pasados a colores de vértice (un solo material en el juego);
  - maderas y tejado ajustados a la paleta del aserradero (`wood` #c08a52, `wood2` #8a5a33,
    `roof` #b3432f);
  - el disco de la sierra circular separado en una pieza propia para poder girarlo;
  - sin normales ni coordenadas de textura (el juego usa sombreado plano).
- **Modelos usados:** `mill_sign`, `sawhorse`, `firewood_stack`, `stump_chopping_block`,
  `log_cart`, `log_cabin_office`, `plank_stack_big`, `lumber_bundle`, `drying_shed`,
  `circular_saw_table`, `band_saw`, `sawdust_pile`, `log_conveyor`, `log_splitter`,
  `sawmill_building`, `sawmill_boiler`, `sawdust_blower`, `forklift_log_loader`, `log_pile`,
  `watchtower`, `fuel_barrel`, `single_log`.
- **Crédito:** «Low Poly Lumber Mill Pack by reodesuxz».

### Personaje anterior (ya no se usa)
- **Autor:** Quaternius · **Archivo:** `public/assets/models/lumberjack.glb`
- Sustituido por el Worker en la Fase 5. Se conserva hasta confirmar el cambio visualmente.

## Sonidos (Fase 6: tala)
Los archivos del juego están en `public/assets/audio/` (convertidos con `afconvert` de macOS a
WAV mono 22 kHz: formato compatible con todos los navegadores y adecuado para sonido posicional).

| Archivo del juego | Uso | Origen | Licencia |
|---|---|---|---|
| `wood_crack.wav` | Madera que se parte (último golpe) | Kenney — Impact Sounds 1.0 (`impactPlank_medium_000.ogg`), www.kenney.nl | CC0 1.0 (verificada en su `License.txt`) |
| `axe_body_0…4.wav` | Capa grave del hachazo (variante al azar en cada golpe) | Kenney — Impact Sounds 1.0 (`impactWood_heavy_000…004.ogg`) | CC0 1.0 |
| `ground_thud_0…4.wav` | Capa grave del árbol al tocar el suelo | Kenney — Impact Sounds 1.0 (`impactSoft_heavy_000…004.ogg`) | CC0 1.0 |
| `axe_hit.wav` | Golpe del hacha | `acha.mp3` aportado por el director del proyecto | **Pendiente de registrar** |
| `tree_fall.wav` | Crujidos de la caída (tramo 0,12–1,52 s) e impacto contra el suelo (desde 1,58 s) | `arbol caido.mp3` (en realidad Ogg Vorbis) aportado por el director del proyecto | **Pendiente de registrar** |
| `step_grass_0…4.wav` | Pasos del Worker sobre hierba (variante al azar) | Kenney — Impact Sounds 1.0 (`footstep_grass_000…004.ogg`) | CC0 1.0 |
| `step_wood_0…4.wav` | Pasos sobre la madera del aserradero | Kenney — Impact Sounds 1.0 (`footstep_wood_000…004.ogg`) | CC0 1.0 |
| `sale_bonus.wav` | Venta: monedas ganadas (0 s) | «Bonus Points» de **Liecio** (Pixabay) — https://pixabay.com/sound-effects/bonus-points-190035/ · original `liecio-bonus-points-190035.mp3` | Pixabay Content License |
| `sale_chime.wav` | Venta: conteo y destellos (0,45 s) | «Reward Chime» de **Universfield** (Pixabay) — https://pixabay.com/sound-effects/reward-chime-144757/ · original `universfield-reward-chime-144757.mp3` | Pixabay Content License |
| `sale_levelup.wav` | Venta: cierre y nuevo saldo (1,40 s) | «Level Up 06» de **Universfield** (Pixabay) — https://pixabay.com/sound-effects/level-up-06-370051/ · original `universfield-level-up-06-370051.mp3` | Pixabay Content License |

### Sonidos de la venta (Pixabay)
- Licencia verificada en la página de cada sonido (noviembre de 2026): «Free for use under the Pixabay
  Content License» — https://pixabay.com/service/license-summary/ . Permite el uso comercial y no exige
  atribución (se acredita igualmente). Prohíbe distribuir el contenido «tal cual» por separado; aquí se usa
  editado (recortes, fundidos, mezcla a mono, nivelado) y combinado en la secuencia sonora del juego.
- Originales sin modificar en `recursos-originales/` (no se versionan). Los archivos del juego se generan
  con `node herramientas/procesar_audio_venta.mjs`.
- Pasos: recortados a su parte audible y nivelados con `node herramientas/procesar_pasos.mjs` (originales de
  Kenney en `recursos-originales/kenney_impact-sounds/`).

## Bibliotecas
- Three.js (MIT) · cannon-es (MIT) · Appwrite Web SDK (BSD-3-Clause) · Vite (MIT)
