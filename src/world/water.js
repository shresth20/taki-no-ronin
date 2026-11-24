import * as THREE from 'three';
import { envUniforms, GLSL_FOG } from './env.js';
import { WATER_Y, WATER_RECT, FALLS, cliffZ, heightAt } from './terrain.js';
import { getSoftTexture, mulberry32, lerp } from '../core/util.js';

const MAX_RIPPLES = 10;

/* River + plunge pool surface.
   depth colour, flow-mapped ripples, cel caustic lines, shoreline and churn foam,
   interactive ripple rings, sun glitter and an optional planar reflection.        */
export function createWater(dataTex, reflectSize) {
  const { x0, x1, z0, z1 } = WATER_RECT;
  const ripples = [];
  for (let i = 0; i < MAX_RIPPLES; i++) ripples.push(new THREE.Vector4(0, 0, -100, 0));
  const uniforms = {
    ...envUniforms,
    uData: { value: dataTex },
    uRefl: { value: null },
    uHasRefl: { value: 0 },
    uTexMatrix: { value: new THREE.Matrix4() },
    uRect: { value: new THREE.Vector4(x0, z0, x1 - x0, z1 - z0) },
    uShallow: { value: new THREE.Color('#5fe0d0') },
    uDeep: { value: new THREE.Color('#0e6f86') },
    uFoam: { value: new THREE.Color('#f4fffb') },
    uRipples: { value: ripples },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform vec4 uRect; uniform mat4 uTexMatrix;
      varying vec3 vW; varying vec2 vD; varying vec4 vRefl;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vD = (wp.xz - uRect.xy) / uRect.zw;
        vRefl = uTexMatrix * wp;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uData, uNoise, uRefl;
      uniform float uTime, uHasRefl;
      uniform vec3 uShallow, uDeep, uFoam, uSunDir, uSunColor, uSkyTop, uSkyHorizon;
      uniform vec4 uRipples[${MAX_RIPPLES}];
      varying vec3 vW; varying vec2 vD; varying vec4 vRefl;
      ${GLSL_FOG}
      void main(){
        vec4 dat = texture2D(uData, vD);
        float depth = -dat.r;
        if (depth < -0.12) discard;
        vec2 flow = dat.gb;
        float churn = dat.a;

        // two-phase flow so the ripples travel downstream without stretching
        float ph = uTime * 0.32;
        float p0 = fract(ph), p1 = fract(ph + 0.5);
        float w1 = abs(1.0 - 2.0 * p0);
        vec2 base = vW.xz * 0.13;
        vec4 n0 = texture2D(uNoise, base - flow * p0 * 0.9);
        vec4 n1 = texture2D(uNoise, base - flow * p1 * 0.9 + 0.43);
        vec4 nf = texture2D(uNoise, vW.xz * 0.47 + uTime * vec2(0.021, 0.034));
        vec2 slope = mix(n0.rg, n1.rg, w1) - 0.5;
        slope += (nf.ga - 0.5) * 0.45;
        slope *= 0.55 + churn * 1.6;

        // interactive ripple rings
        float ringFoam = 0.0;
        for (int i = 0; i < ${MAX_RIPPLES}; i++){
          vec4 r = uRipples[i];
          float age = uTime - r.z;
          if (age < 0.0 || age > 2.6) continue;
          vec2 dv = vW.xz - r.xy; float d = length(dv);
          float rad = age * 2.4 + 0.15;
          float dr = (d - rad) * 2.6;
          float k = exp(-dr * dr) * r.w * (1.0 - age / 2.6);
          slope += (dv / (d + 0.01)) * k * 1.4;
          ringFoam += k * smoothstep(0.55, 0.9, k + nf.r * 0.4);
        }

        vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
        vec3 V = normalize(cameraPosition - vW);
        float ndv = max(dot(N, V), 0.0);
        float fres = 0.03 + 0.97 * pow(1.0 - ndv, 4.0);

        // body colour by depth, with cel caustic lines that drift with the current
        float dk = 1.0 - exp(-max(depth, 0.0) * 1.35);
        vec3 body = mix(uShallow, uDeep, dk);
        vec2 cuv = vW.xz * 0.085 + slope * 0.06;
        float c0 = texture2D(uNoise, cuv - flow * p0 * 0.55).b;
        float c1 = texture2D(uNoise, cuv - flow * p1 * 0.55 + 0.31).b;
        float caust = smoothstep(0.085, 0.02, mix(c0, c1, w1));
        body += caust * mix(vec3(0.55, 0.95, 0.9), vec3(1.0), 0.4) * (0.28 * exp(-depth * 0.9) + 0.10);

        // reflection: planar texture when available, analytic sky otherwise
        vec3 R = reflect(-V, N);
        vec3 refl = mix(uSkyHorizon, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.55));
        if (uHasRefl > 0.5) {
          vec2 ruv = vRefl.xy / vRefl.w + slope * 0.09;
          vec2 e = smoothstep(vec2(0.0), vec2(0.06), ruv) * smoothstep(vec2(1.0), vec2(0.94), ruv);
          refl = mix(refl, texture2D(uRefl, clamp(ruv, 0.002, 0.998)).rgb, e.x * e.y);   // fade to sky at the mirror's edge
        }
        vec3 col = mix(body, refl, clamp(fres * 0.9 + 0.06, 0.0, 1.0));

        // sun: broad sheen plus stepped glitter
        float sd = max(dot(R, uSunDir), 0.0);
        float glit = step(0.6, nf.a) * step(0.55, n0.g + n1.g * 0.5);
        col += uSunColor * (pow(sd, 260.0) * 2.2 + pow(sd, 22.0) * glit * 0.9);

        // foam: shoreline lapping, waterfall churn, fast-water streaks, ripple crests
        float fn = mix(n0.g, n1.g, w1);
        float lap = sin(uTime * 1.3 + vW.x * 0.6 + vW.z * 0.4) * 0.04;
        float shore = 1.0 - smoothstep(0.0, 0.2 + lap, depth);
        float foam = smoothstep(0.42, 0.62, shore * 0.85 + fn * 0.42 * step(0.02, shore));
        foam = max(foam, smoothstep(0.52, 0.68, churn * 0.75 + fn * churn * 0.9));
        foam = max(foam, smoothstep(0.76, 0.82, fn + length(flow) * 0.08) * 0.42 * smoothstep(0.1, 0.4, depth));
        foam = max(foam, clamp(ringFoam, 0.0, 1.0));
        col = mix(col, uFoam * mix(vec3(0.82, 0.93, 0.95), vec3(1.0), smoothstep(0.5, 0.75, fn)), foam);

        float alpha = clamp(0.42 + dk * 0.62 + fres * 0.5 + foam, 0.0, 1.0);
        alpha *= smoothstep(-0.12, -0.02, depth);
        gl_FragColor = vec4(applyFog(col, vW), alpha);
      }`,
  });
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((x0 + x1) / 2, WATER_Y, (z0 + z1) / 2);
  mesh.renderOrder = 5;
  mesh.name = 'water';
  mesh.layers.set(1); // not drawn into its own reflection

  /* ---- planar reflection (after three.js Reflector) ---- */
  let rt = null;
  const vcam = new THREE.PerspectiveCamera();
  vcam.layers.set(0);
  const plane = new THREE.Plane(), nrm = new THREE.Vector3(0, 1, 0), rpos = new THREE.Vector3(0, WATER_Y, 0);
  const cpos = new THREE.Vector3(), rot = new THREE.Matrix4(), look = new THREE.Vector3(), view = new THREE.Vector3(), target = new THREE.Vector3();
  const clip = new THREE.Vector4(), q = new THREE.Vector4();
  if (reflectSize > 0) {
    rt = new THREE.WebGLRenderTarget(reflectSize, reflectSize, { type: THREE.HalfFloatType, samples: 0, depthBuffer: true });
    rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
    uniforms.uRefl.value = rt.texture;
    uniforms.uHasRefl.value = 1;
  }
  function renderReflection(gl, scene, camera) {
    if (!rt || !reflectOn) return;
    cpos.setFromMatrixPosition(camera.matrixWorld);
    if (cpos.y <= WATER_Y + 0.05) return;
    rot.extractRotation(camera.matrixWorld);
    view.subVectors(rpos, cpos).reflect(nrm).negate().add(rpos);
    look.set(0, 0, -1).applyMatrix4(rot).add(cpos);
    target.subVectors(rpos, look).reflect(nrm).negate().add(rpos);
    vcam.position.copy(view);
    vcam.up.set(0, 1, 0).applyMatrix4(rot).reflect(nrm);
    vcam.lookAt(target);
    vcam.near = camera.near;
    vcam.far = camera.far;
    vcam.updateMatrixWorld();
    vcam.projectionMatrix.copy(camera.projectionMatrix);
    uniforms.uTexMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);
    // oblique near plane so nothing below the surface leaks into the mirror
    plane.setFromNormalAndCoplanarPoint(nrm, rpos).applyMatrix4(vcam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = vcam.projectionMatrix;
    q.x = (Math.sign(clip.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(clip.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1;
    q.w = (1 + pm.elements[10]) / pm.elements[14];
    clip.multiplyScalar(2 / clip.dot(q));
    pm.elements[2] = clip.x;
    pm.elements[6] = clip.y;
    pm.elements[10] = clip.z + 1 - 0.003;
    pm.elements[14] = clip.w;
    const prevRT = gl.getRenderTarget(), prevAuto = gl.shadowMap.autoUpdate, prevXr = gl.xr.enabled;
    gl.xr.enabled = false;
    gl.shadowMap.autoUpdate = false;
    gl.setRenderTarget(rt);
    gl.state.buffers.depth.setMask(true);
    if (gl.autoClear === false) gl.clear();
    gl.render(scene, vcam);
    gl.xr.enabled = prevXr;
    gl.shadowMap.autoUpdate = prevAuto;
    gl.setRenderTarget(prevRT);
  }

  function setReflectSize(size) {
    if (!rt) return;
    uniforms.uHasRefl.value = size > 0 ? 1 : 0;
    if (size > 0 && rt.width !== size) rt.setSize(size, size);
    reflectOn = size > 0;
  }
  let reflectOn = true;
  let rippleI = 0;
  function addRipple(x, z, strength = 1) {
    ripples[rippleI].set(x, z, envUniforms.uTime.value, strength);
    rippleI = (rippleI + 1) % MAX_RIPPLES;
  }
  return { mesh, renderReflection, addRipple, setReflectSize, uniforms };
}

/* ---------- waterfall sheets ---------- */
function fallGeometry(x, width, yTop, yBase, zLip, zBase, run = 6) {
  // profile: a short run along the plateau, over the lip, then a parabola down to the pool
  const nu = 14, nv = 48;
  const g = new THREE.PlaneGeometry(1, 1, nu, nv);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const s = p.getX(i), t = 0.5 - p.getY(i); // t: 0 top .. 1 bottom
    let y, z;
    const lipT = 0.07;
    if (t < lipT) {
      const k = t / lipT;
      y = yTop + 0.5 * (1 - k);
      z = zLip - run * (1 - k);
    } else {
      const k = (t - lipT) / (1 - lipT);
      y = lerp(yTop, yBase, k * k * 0.35 + k * 0.65);
      z = zLip + (zBase - zLip) * Math.sqrt(k);
    }
    const bow = Math.cos(s * Math.PI) * 0.9; // sheet bows outward in the middle
    p.setXYZ(i, x + s * width, y, z + bow * Math.min(1, t * 6));
    uv.setXY(i, s + 0.5, t);
  }
  g.computeVertexNormals();
  return g;
}

export const fallMaterial = (speed, alpha, streak, len = 1) =>
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { ...envUniforms, uSpeed: { value: speed }, uAlpha: { value: alpha }, uStreak: { value: streak }, uLen: { value: len } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vW;
        void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uNoise; uniform float uTime, uSpeed, uAlpha, uStreak, uLen;
        uniform vec3 uSunColor, uSkyHorizon, uSkyTop;
        varying vec2 vUv; varying vec3 vW;
        ${GLSL_FOG}
        void main(){
          float fall = vUv.y;
          float t = uTime * uSpeed;
          vec2 p = vec2(vUv.x * uStreak, fall * uLen - t);
          float a = texture2D(uNoise, p * vec2(1.0, 0.22)).g;
          float b = texture2D(uNoise, p * vec2(2.6, 0.36) + vec2(0.3, -t * 0.35)).r;
          float c = texture2D(uNoise, p * vec2(7.0, 0.8) + vec2(0.0, -t * 0.7)).a;
          float body = a * 0.5 + b * 0.35 + c * 0.25;
          float edge = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
          float al = smoothstep(0.3, 0.52, edge * 1.25 + (body - 0.5) * 0.85);
          // three cel tones: shadowed teal, pale water, white foam
          vec3 shade = mix(uSkyTop, vec3(0.42, 0.74, 0.8), 0.7);
          vec3 col = mix(shade, vec3(0.8, 0.94, 0.96), smoothstep(0.47, 0.53, body));
          col = mix(col, vec3(1.0), smoothstep(0.6, 0.68, body));
          col = mix(col, vec3(1.0), smoothstep(0.72, 1.0, fall) * 0.85);       // churned white at the foot
          col = mix(col, vec3(0.75, 0.93, 0.92), smoothstep(0.12, 0.0, fall) * 0.6); // glassy lip
          col *= mix(vec3(1.0), uSunColor, 0.3) * 1.05;
          al *= mix(0.78, 1.0, smoothstep(0.0, 0.3, fall)) * uAlpha;
          al *= smoothstep(0.0, 0.03, fall);
          gl_FragColor = vec4(applyFog(col, vW), al);
        }`,
    });
export { fallGeometry };

export function createWaterfall() {
  const group = new THREE.Group();
  group.name = 'waterfall';
  const fallMat = fallMaterial;
  const add = (x, width, yTop, zOff, speed, alpha, streak, len) => {
    const cz = cliffZ(x);
    const m = new THREE.Mesh(fallGeometry(x, width, yTop, WATER_Y - 0.1, cz - 4.2 + zOff, cz - 0.6 + zOff, 6), fallMat(speed, alpha, streak));
    m.material.uniforms.uLen.value = len;
    m.renderOrder = 6;
    m.frustumCulled = false;
    group.add(m);
    return m;
  };
  add(FALLS.x, FALLS.width, FALLS.top, 0, 0.5, 1.0, 3.2, 2.6);
  add(FALLS.x + 0.6, FALLS.width * 0.8, FALLS.top - 0.2, 0.7, 0.72, 0.55, 5.0, 3.4); // faster spray layer in front
  add(-27, 3.4, 30, 1.2, 0.6, 0.9, 1.6, 2.4); // side ribbons
  add(31, 2.6, 27, 1.4, 0.66, 0.85, 1.3, 2.2);
  return group;
}

/* ---------- billboarded mist: drifts up from the foot of the falls and hangs over the river ---------- */
export function createMist() {
  const rnd = mulberry32(909);
  const N = 110;
  const origin = new Float32Array(N * 3), seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    let x, y, z, size, rise;
    if (i < 64) {
      // waterfall spray
      x = FALLS.x + (rnd() - 0.5) * (FALLS.width + 5);
      z = FALLS.zBase + 0.5 + rnd() * 5;
      y = WATER_Y + 0.4 + rnd() * 2;
      size = 5 + rnd() * 7;
      rise = 4 + rnd() * 9;
    } else if (i < 76) {
      const sx = i % 2 ? -27 : 31;
      x = sx + (rnd() - 0.5) * 4;
      z = cliffZ(sx) + 1 + rnd() * 2;
      y = 0.5 + rnd();
      size = 3 + rnd() * 3;
      rise = 3 + rnd() * 3;
    } else {
      // low river haze
      x = -30 + rnd() * 60;
      z = -34 + rnd() * 80;
      y = Math.max(heightAt(x, z), 0) + 0.6 + rnd() * 0.8;
      size = 9 + rnd() * 9;
      rise = 0.6 + rnd();
    }
    origin.set([x, y, z], i * 3);
    seed.set([rnd(), size, rise, i < 76 ? 1 : 0.42], i * 4);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = new THREE.PlaneGeometry(1, 1).index;
  geo.setAttribute('position', new THREE.PlaneGeometry(1, 1).attributes.position);
  geo.setAttribute('uv', new THREE.PlaneGeometry(1, 1).attributes.uv);
  geo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origin, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.instanceCount = N;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ...envUniforms, uMap: { value: getSoftTexture() } },
    vertexShader: /* glsl */ `
      attribute vec3 aOrigin; attribute vec4 aSeed;
      uniform float uTime, uWindK;
      varying vec2 vUv; varying float vA; varying vec3 vW;
      void main(){
        float t = fract(uTime * (0.045 + aSeed.x * 0.04) + aSeed.x * 7.0);
        vec3 p = aOrigin + vec3((0.6 + uWindK * 0.8) * t * 4.0, aSeed.z * t, t * 2.5);
        float size = aSeed.y * (0.55 + t * 0.9);
        vA = sin(3.14159 * t) * aSeed.w;
        vUv = uv; vW = p;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        mv.xy += position.xy * size;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uMap; uniform vec3 uSunColor, uSkyHorizon;
      varying vec2 vUv; varying float vA; varying vec3 vW;
      ${GLSL_FOG}
      void main(){
        float a = texture2D(uMap, vUv).a * vA * 0.22;
        vec3 col = mix(uSkyHorizon, vec3(1.0), 0.55) * mix(vec3(1.0), uSunColor, 0.35);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  mesh.layers.set(1);
  mesh.name = 'mist';
  return mesh;
}
