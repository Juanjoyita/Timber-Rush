// physics.js — Mundo físico con cannon-es.
// FASE 5: terreno (Heightfield), colisiones estáticas (árboles, rocas, aserradero),
// límites invisibles de la zona jugable y cuerpo dinámico del personaje.
//
// Criterios:
// - Solo el personaje es DINÁMICO (masa > 0). Todo lo demás es ESTÁTICO (masa 0):
//   no se mueve, no consume cálculo de integración y solo participa en colisiones.
// - Formas simples: esferas (personaje, troncos y rocas), cajas (aserradero, troncos caídos
//   y límites) y un Heightfield para el suelo.
// - SAPBroadphase: descarta rápidamente los pares de cuerpos lejanos, así el personaje
//   solo se compara con los obstáculos cercanos aunque haya más de 150 cuerpos.
import * as CANNON from 'cannon-es';
import { heightAt, WORLD } from './forest.js';

// Radio de la esfera física del personaje (m). Representa el volumen real del Worker: con
// 0,35 m sus pies y brazos (que sobresalen hasta 0,47 m parado) entraban en los troncos.
export const PLAYER_RADIUS = 0.45;
export const FIXED_STEP = 1 / 60; // Paso fijo de la simulación (s)

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
  const obstacleSphere = (x, z, radius) =>
    addStatic(new CANNON.Sphere(radius), x, heightAt(x, z) + PLAYER_RADIUS, z, materials.obstacle);

  // Se guarda el cuerpo en el árbol (userData.body) para poder desactivarlo al talarlo (Fase 6)
  for (const tree of forest.trees) {
    tree.userData.body = obstacleSphere(tree.position.x, tree.position.z, tree.userData.radius);
  }
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

  // --- Troncos caídos: una caja estática orientada por tronco ---
  for (const c of forest.decorColliders) {
    const log = new CANNON.Body({ mass: 0, material: materials.obstacle });
    log.position.set(c.x, c.y, c.z);
    log.quaternion.setFromEuler(0, c.rotY, 0);
    log.addShape(new CANNON.Box(new CANNON.Vec3(c.hx, c.hy, c.hz)));
    world.addBody(log);
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
    return body;
  };

  return { world, materials, createPlayerBody };
}
