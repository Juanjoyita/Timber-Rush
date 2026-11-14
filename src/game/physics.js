// physics.js — Mundo físico con cannon-es.
// FASE 5: terreno (Heightfield), colisiones estáticas (árboles, rocas, aserradero),
// límites invisibles de la zona jugable y cuerpo dinámico del personaje.
//
// Criterios:
// - Solo el personaje es DINÁMICO (masa > 0). Todo lo demás es ESTÁTICO (masa 0):
//   no se mueve, no consume cálculo de integración y solo participa en colisiones.
// - Formas simples: esferas (personaje, troncos y rocas), cajas (aserradero, troncos caídos
//   y límites) y un Heightfield para el suelo.
// - SAPBroadphase: descarta rápidamente los pares de cuerpos lejanos.
// - Troncos activados por proximidad: cannon-es recorre TODOS los cuerpos del mundo en cada
//   paso (aunque estén quietos y lejos), así que con un bosque muy denso la física se
//   encarecía (0,8 ms con 300 árboles, 3,6 ms con 900). Solo están en el mundo los troncos a
//   menos de ACTIVE_RADIUS del personaje; al alejarse más de INACTIVE_RADIUS se retiran.
//   El coste ya no depende del tamaño del bosque y el personaje sigue chocando con todos los
//   troncos que tiene alrededor.
import * as CANNON from 'cannon-es';
import { heightAt, PLAYER_RADIUS, WORLD } from './forest.js';

// Radio de la esfera física del personaje: definido en forest.js (lo usa también para
// comprobar que todos los árboles se pueden alcanzar a pie) y reexportado aquí.
export { PLAYER_RADIUS };
export const FIXED_STEP = 1 / 60; // Paso fijo de la simulación (s)

// Activación de troncos por proximidad (m). El personaje corre a 3,5 m/s: el margen entre los
// dos radios evita que un tronco entre y salga del mundo en cada fotograma.
export const ACTIVE_RADIUS = 12;
export const INACTIVE_RADIUS = 15;
const TRUNK_CELL = 8; // Celda de la rejilla espacial de troncos (m)

const TERRAIN_STEP = 2.5; // Separación de la rejilla del Heightfield = la del terreno visual
const TERRAIN_HALF = WORLD.playHalf + TERRAIN_STEP; // Cubre la zona jugable con margen

/**
 * Crea el mundo físico a partir de los datos del bosque.
 * @param forest Resultado de createForest(): trees, rocks, sawmillColliders y decorColliders.
 */
export function createPhysics(forest) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true; // Los cuerpos en reposo dejan de simularse

  // Materiales físicos: definen fricción y restitución en cada tipo de contacto.
  const materials = {
    ground: new CANNON.Material('suelo'),
    obstacle: new CANNON.Material('obstaculo'),
    player: new CANNON.Material('jugador'),
  };
  // Fricción 0 entre el personaje y el resto: su velocidad la controla el código,
  // y así no se "engancha" al rozar troncos o paredes. Restitución 0: no rebota.
  world.addContactMaterial(new CANNON.ContactMaterial(materials.player, materials.ground, { friction: 0, restitution: 0 }));
  world.addContactMaterial(new CANNON.ContactMaterial(materials.player, materials.obstacle, { friction: 0, restitution: 0 }));

  // IMPORTANTE: primero se coloca el cuerpo y DESPUÉS se añade la forma.
  // Si la forma se pasa al constructor, cannon-es calcula la caja envolvente (AABB)
  // en el origen; al mover un cuerpo estático esa caja no se recalcula y la fase de
  // detección amplia (broadphase) nunca detecta el choque. (Comprobado en las pruebas.)
  const addStatic = (shape, x, y, z, material) => {
    const body = new CANNON.Body({ mass: 0, material });
    body.position.set(x, y, z);
    body.addShape(shape);
    world.addBody(body);
    return body;
  };

  // --- Suelo: Heightfield construido con la MISMA función heightAt del terreno visual ---
  // El Heightfield de cannon-es está en su plano XY local con la altura en Z;
  // se gira -90° en X para que la altura quede en el eje Y del mundo.
  // Con ese giro, el punto local (i, j) cae en el mundo en (x0 + i·paso, altura, z0 − j·paso).
  const n = Math.round((2 * TERRAIN_HALF) / TERRAIN_STEP) + 1;
  const data = [];
  for (let i = 0; i < n; i++) {
    const column = [];
    for (let j = 0; j < n; j++) column.push(heightAt(-TERRAIN_HALF + i * TERRAIN_STEP, TERRAIN_HALF - j * TERRAIN_STEP));
    data.push(column);
  }
  const ground = new CANNON.Body({ mass: 0, material: materials.ground });
  ground.addShape(new CANNON.Heightfield(data, { elementSize: TERRAIN_STEP }));
  ground.position.set(-TERRAIN_HALF, 0, TERRAIN_HALF);
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);

  // --- Troncos y rocas: una ESFERA estática por obstáculo, a la altura del centro del personaje ---
  // ¿Por qué no cilindros? En las pruebas, el contacto esfera-cilindro de cannon-es
  // (el cilindro es un poliedro convexo) dejaba penetrar 3-16 cm al chocar cerca de una
  // arista. El contacto esfera-esfera es exacto y el más barato. Como el personaje siempre
  // camina por el suelo (no salta), una esfera centrada a su misma altura produce un choque
  // horizontal: en la práctica actúa como un cilindro vertical.
  // "Tapa": una segunda esfera igual, más arriba. Si el personaje llega cuesta abajo (unos
  // centímetros más alto que el centro del obstáculo), el contacto con la esfera baja le empuja
  // un poco hacia arriba y, sin la tapa, terminaba subiéndose por encima de rocas y troncos. La
  // tapa le frena ahí; a la altura del personaje el radio de choque no cambia.
  const OBSTACLE_CAP = 0.5; // m sobre la esfera principal
  const addObstacleShapes = (body, radius) => {
    body.addShape(new CANNON.Sphere(radius));
    body.addShape(new CANNON.Sphere(radius), new CANNON.Vec3(0, OBSTACLE_CAP, 0));
  };
  const obstacleSphere = (x, z, radius) => {
    const body = new CANNON.Body({ mass: 0, material: materials.obstacle });
    body.position.set(x, heightAt(x, z) + PLAYER_RADIUS, z);
    addObstacleShapes(body, radius); // Formas DESPUÉS de colocarlo (AABB correcta)
    world.addBody(body);
    return body;
  };

  // Troncos: el cuerpo se crea siempre (userData.body) pero solo se añade al mundo cuando el
  // personaje está cerca (ver updateActiveTrunks). Se indexan en una rejilla espacial.
  const trunkGrid = new Map();
  for (const tree of forest.trees) {
    const { x, z } = tree.position;
    const body = new CANNON.Body({ mass: 0, material: materials.obstacle });
    body.position.set(x, heightAt(x, z) + PLAYER_RADIUS, z);
    addObstacleShapes(body, tree.userData.radius); // Formas DESPUÉS de colocarlo (AABB correcta)
    tree.userData.body = body;
    const key = `${Math.floor(x / TRUNK_CELL)},${Math.floor(z / TRUNK_CELL)}`;
    if (!trunkGrid.has(key)) trunkGrid.set(key, []);
    trunkGrid.get(key).push(body);
  }
  const activeTrunks = new Set();
  /** Añade los troncos cercanos a "position" y retira los que quedaron lejos. */
  const updateActiveTrunks = (position) => {
    for (const body of activeTrunks) {
      if (Math.hypot(body.position.x - position.x, body.position.z - position.z) > INACTIVE_RADIUS) {
        world.removeBody(body);
        activeTrunks.delete(body);
      }
    }
    const i0 = Math.floor((position.x - ACTIVE_RADIUS) / TRUNK_CELL), i1 = Math.floor((position.x + ACTIVE_RADIUS) / TRUNK_CELL);
    const j0 = Math.floor((position.z - ACTIVE_RADIUS) / TRUNK_CELL), j1 = Math.floor((position.z + ACTIVE_RADIUS) / TRUNK_CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = trunkGrid.get(`${i},${j}`);
        if (!list) continue;
        for (const body of list) {
          if (activeTrunks.has(body)) continue;
          if (Math.hypot(body.position.x - position.x, body.position.z - position.z) <= ACTIVE_RADIUS) {
            world.addBody(body);
            activeTrunks.add(body);
          }
        }
      }
    }
  };
  // Rocas: algo más estrechas que su silueta (son irregulares) y sin poder subirse encima
  for (const rock of forest.rocks) {
    obstacleSphere(rock.position.x, rock.position.z, rock.userData.radius * 0.8);
  }

  // --- Aserradero: un único cuerpo estático con todas sus cajas ---
  const sawmill = new CANNON.Body({ mass: 0, material: materials.obstacle });
  for (const c of forest.sawmillColliders) {
    sawmill.addShape(new CANNON.Box(new CANNON.Vec3(c.hx, c.hy, c.hz)), new CANNON.Vec3(c.x, c.y, c.z));
  }
  world.addBody(sawmill);

  // --- Etapas del aserradero (evolución por niveles): un cuerpo estático que se sustituye ---
  // Solo cambia al cargar el progreso o al comprar un nivel (nunca en cada fotograma).
  let stageBody = null;
  const setStageBoxes = (boxes) => {
    if (stageBody) world.removeBody(stageBody);
    stageBody = null;
    if (!boxes.length) return;
    stageBody = new CANNON.Body({ mass: 0, material: materials.obstacle });
    for (const c of boxes) stageBody.addShape(new CANNON.Box(new CANNON.Vec3(c.hx, c.hy, c.hz)), new CANNON.Vec3(c.x, c.y, c.z));
    world.addBody(stageBody);
  };

  // --- Pieza móvil (la carretilla): caja CINEMÁTICA que se coloca desde el código ---
  // No la mueve la simulación; la animación solo avanza si no va a tocar al personaje.
  const createMovingBox = (hx, hy, hz) => {
    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: materials.obstacle });
    body.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
    let inWorld = false;
    return {
      body,
      moveTo(x, y, z) {
        body.position.set(x, y, z);
        body.previousPosition.set(x, y, z);
        body.interpolatedPosition.set(x, y, z);
        body.aabbNeedsUpdate = true;
      },
      setEnabled(on) {
        if (on && !inWorld) world.addBody(body);
        if (!on && inWorld) world.removeBody(body);
        inWorld = on;
      },
      get enabled() {
        return inWorld;
      },
    };
  };

  // --- Troncos caídos: una caja estática orientada por tronco ---
  for (const c of forest.decorColliders) {
    const log = new CANNON.Body({ mass: 0, material: materials.obstacle });
    log.position.set(c.x, c.y, c.z);
    log.quaternion.setFromEuler(0, c.rotY, 0);
    log.addShape(new CANNON.Box(new CANNON.Vec3(c.hx, c.hy, c.hz)));
    world.addBody(log);
  }

  // --- Elemento emblemático del bosque (Fase 11A): esferas como las rocas y cajas orientadas ---
  const lm = forest.landmarkColliders ?? { spheres: [], boxes: [] };
  for (const c of lm.spheres) obstacleSphere(c.x, c.z, c.r);
  for (const c of lm.boxes) {
    const body = new CANNON.Body({ mass: 0, material: materials.obstacle });
    body.position.set(c.x, c.y, c.z);
    body.quaternion.setFromEuler(0, c.rotY, 0);
    body.addShape(new CANNON.Box(new CANNON.Vec3(c.hx, c.hy, c.hz)));
    world.addBody(body);
  }

  // --- Límites invisibles de la zona jugable (120 × 120): cuatro muros altos ---
  const H = WORLD.playHalf;
  // Una forma por muro: en cannon-es cada forma guarda una referencia a su cuerpo
  const wallX = () => new CANNON.Box(new CANNON.Vec3(0.5, 10, H + 1));
  const wallZ = () => new CANNON.Box(new CANNON.Vec3(H + 1, 10, 0.5));
  addStatic(wallX(), H + 0.5, 5, 0, materials.obstacle);
  addStatic(wallX(), -H - 0.5, 5, 0, materials.obstacle);
  addStatic(wallZ(), 0, 5, H + 0.5, materials.obstacle);
  addStatic(wallZ(), 0, 5, -H - 0.5, materials.obstacle);

  /** Crea el cuerpo dinámico del personaje apoyado en el suelo en (x, z). */
  const createPlayerBody = (x, z) => {
    const body = new CANNON.Body({
      mass: 70, // kg (solo influye en cómo empuja; la velocidad la fija el código)
      material: materials.player,
      shape: new CANNON.Sphere(PLAYER_RADIUS),
      fixedRotation: true, // La esfera no rueda: el giro del personaje es solo visual
      linearDamping: 0,
      allowSleep: false, // El personaje siempre responde a las teclas
    });
    body.position.set(x, heightAt(x, z) + PLAYER_RADIUS + 0.02, z);
    world.addBody(body);
    player = body;
    updateActiveTrunks(body.position);
    return body;
  };

  // Antes de cada paso de la simulación se actualizan los troncos activos alrededor del
  // personaje (así funciona igual desde el juego y desde las pruebas, que llaman a step()).
  let player = null;
  const step = world.step.bind(world);
  world.step = (dt, timeSinceLastCalled, maxSubSteps) => {
    if (player) updateActiveTrunks(player.position);
    step(dt, timeSinceLastCalled, maxSubSteps);
  };

  return { world, materials, createPlayerBody, activeTrunks, updateActiveTrunks, setStageBoxes, createMovingBox };
}
