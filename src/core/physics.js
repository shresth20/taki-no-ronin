import * as THREE from 'three';
import { heightAt, WATER_Y, buildCollisionGrid, PLAY } from '../world/terrain.js';

/* Rapier drives character-vs-obstacle collision (kinematic character controllers) and
   rigid-body debris (dropped hats, weapons, cut straw). If WebAssembly is unavailable the
   same interface falls back to a tiny built-in solver so the game still plays.            */
const GROUP_OBSTACLE = 0x0001, GROUP_TERRAIN = 0x0002, GROUP_DEBRIS = 0x0004, GROUP_CHAR = 0x0008;
const groups = (member, filter) => ((member << 16) | filter) >>> 0;

export async function createPhysics(colliders) {
  let R = null;
  try {
    const mod = await import('@dimforge/rapier3d-compat');
    R = mod.default ?? mod;
    await R.init();
  } catch (e) {
    console.warn('Rapier unavailable, using fallback physics', e);
    R = null;
  }
  return R ? rapierBackend(R, colliders) : fallbackBackend(colliders);
}

function rapierBackend(R, colliders) {
  const world = new R.World({ x: 0, y: -24, z: 0 });
  world.timestep = 1 / 60;
  // static obstacles: tree trunks, boulders, pillars, lanterns ...
  for (const c of colliders) {
    const y = heightAt(c.x, c.z);
    const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(c.x, y + 1.5, c.z));
    world.createCollider(R.ColliderDesc.cylinder(2.5, c.r).setCollisionGroups(groups(GROUP_OBSTACLE, 0xffff)), body);
  }
  // coarse ground mesh for debris to land on
  const grid = buildCollisionGrid(2, 44);
  const ground = world.createRigidBody(R.RigidBodyDesc.fixed());
  world.createCollider(R.ColliderDesc.trimesh(grid.verts, grid.idx).setCollisionGroups(groups(GROUP_TERRAIN, GROUP_DEBRIS)).setFriction(0.9), ground);

  const controller = world.createCharacterController(0.03);
  controller.setSlideEnabled(true);
  controller.setApplyImpulsesToDynamicBodies(false);
  const charFilter = groups(GROUP_CHAR, GROUP_OBSTACLE);
  const chars = [];
  const debris = [];
  const tmp = { x: 0, y: 0, z: 0 };

  function createCharacter(radius = 0.38, height = 1.7) {
    const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    const col = world.createCollider(R.ColliderDesc.capsule(Math.max(0.05, height / 2 - radius), radius).setCollisionGroups(groups(GROUP_CHAR, GROUP_OBSTACLE | GROUP_DEBRIS)), body);
    const h = { body, col, radius, height };
    chars.push(h);
    return h;
  }
  /** move `pos` (THREE.Vector3, feet position) by (dx, dz) with obstacle sliding */
  function moveCharacter(h, pos, dx, dz) {
    const cy = pos.y + h.height / 2;
    h.body.setTranslation({ x: pos.x, y: cy, z: pos.z }, false);
    tmp.x = dx; tmp.y = 0; tmp.z = dz;
    controller.computeColliderMovement(h.col, tmp, undefined, charFilter);
    const m = controller.computedMovement();
    pos.x += m.x;
    pos.z += m.z;
    h.body.setNextKinematicTranslation({ x: pos.x, y: cy, z: pos.z });
  }
  function teleport(h, pos) {
    h.body.setTranslation({ x: pos.x, y: pos.y + h.height / 2, z: pos.z }, true);
  }
  function removeCharacter(h) {
    world.removeRigidBody(h.body);
    const i = chars.indexOf(h);
    if (i >= 0) chars.splice(i, 1);
  }
  /** rigid-body debris: mesh is driven by the simulation until it expires */
  function spawnDebris(mesh, pos, vel, spin, shape = { box: [0.2, 0.05, 0.2] }, life = 6) {
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinvel(vel.x, vel.y, vel.z).setAngvel({ x: spin.x, y: spin.y, z: spin.z }).setLinearDamping(0.2).setAngularDamping(0.6).setCcdEnabled(false)
    );
    if (mesh.quaternion) body.setRotation({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w }, false);
    const desc = shape.box ? R.ColliderDesc.cuboid(...shape.box) : shape.cyl ? R.ColliderDesc.cylinder(...shape.cyl) : R.ColliderDesc.ball(shape.ball);
    world.createCollider(desc.setCollisionGroups(groups(GROUP_DEBRIS, GROUP_TERRAIN | GROUP_OBSTACLE | GROUP_DEBRIS)).setRestitution(0.25).setFriction(0.8).setDensity(1.2), body);
    debris.push({ mesh, body, life, max: life });
    if (debris.length > 28) expire(debris[0]);
  }
  function expire(d) {
    world.removeRigidBody(d.body);
    d.mesh.parent?.remove(d.mesh);
    debris.splice(debris.indexOf(d), 1);
  }
  let acc = 0;
  function step(dt) {
    acc += dt;
    let n = 0;
    while (acc >= 1 / 60 && n++ < 3) {
      world.step();
      acc -= 1 / 60;
    }
    if (acc > 0.1) acc = 0;
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.life -= dt;
      const t = d.body.translation(), q = d.body.rotation();
      d.mesh.position.set(t.x, t.y, t.z);
      d.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      if (d.life < 0.6) d.mesh.scale.setScalar(Math.max(0.01, d.life / 0.6) * (d.mesh.userData.baseScale ?? 1));
      if (d.life <= 0 || t.y < -6) expire(d);
    }
  }
  function clearDebris() {
    while (debris.length) expire(debris[0]);
  }
  return { name: 'Rapier', createCharacter, moveCharacter, teleport, removeCharacter, spawnDebris, step, clearDebris };
}

function fallbackBackend(colliders) {
  const debris = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  return {
    name: 'fallback',
    createCharacter: (radius = 0.38, height = 1.7) => ({ radius, height }),
    moveCharacter(h, pos, dx, dz) {
      pos.x += dx;
      pos.z += dz;
      for (const c of colliders) {
        const ox = pos.x - c.x, oz = pos.z - c.z, min = c.r + h.radius;
        const d2 = ox * ox + oz * oz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          pos.x = c.x + (ox / d) * min;
          pos.z = c.z + (oz / d) * min;
        }
      }
    },
    teleport() {},
    removeCharacter() {},
    spawnDebris(mesh, pos, vel, spin, shape, life = 6) {
      mesh.position.copy(pos);
      debris.push({ mesh, vel: vel.clone(), spin: spin.clone(), life });
    },
    step(dt) {
      for (let i = debris.length - 1; i >= 0; i--) {
        const d = debris[i];
        d.life -= dt;
        d.vel.y -= 24 * dt;
        d.mesh.position.addScaledVector(d.vel, dt);
        const g = Math.max(heightAt(d.mesh.position.x, d.mesh.position.z), WATER_Y - 0.3) + 0.06;
        if (d.mesh.position.y < g) {
          d.mesh.position.y = g;
          d.vel.y *= -0.3;
          d.vel.x *= 0.6;
          d.vel.z *= 0.6;
          d.spin.multiplyScalar(0.5);
        }
        e.set(d.spin.x * dt, d.spin.y * dt, d.spin.z * dt);
        d.mesh.quaternion.multiply(q.setFromEuler(e));
        if (d.life < 0.6) d.mesh.scale.setScalar(Math.max(0.01, d.life / 0.6) * (d.mesh.userData.baseScale ?? 1));
        if (d.life <= 0) {
          d.mesh.parent?.remove(d.mesh);
          debris.splice(i, 1);
        }
      }
    },
    clearDebris() {
      for (const d of debris) d.mesh.parent?.remove(d.mesh);
      debris.length = 0;
    },
  };
}
export { PLAY };
