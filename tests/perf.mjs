// Per-zone renderer load at a typical gameplay spot, plus update cost and GPU memory estimates.
export default async function (page, { args }) {
  const spots = [[0, -9, 5], [0, -3, 98], [1, 58, 203], [2, 190, 167], [3, 222, 10], [4, 360, 6], [5, 372, -100], [5, 372, -196]];
  const rows = [];
  for (const [zi, x, z] of spots) {
    rows.push(await page.evaluate(([zi, x, z]) => {
      const G = window.__G, gl = G.gl;
      G.journey.unlockThrough(6);
      window.__goto(zi, x, z);
      window.__step(1 / 30, 20, false);
      gl.info.autoReset = false; gl.info.reset();
      window.__step(1 / 30, 1, true);
      const calls = gl.info.render.calls, tris = gl.info.render.triangles;
      gl.info.autoReset = true;
      const t0 = performance.now();
      window.__step(1 / 60, 240, false);
      const upd = (performance.now() - t0) / 240;
      // memory: geometry attribute bytes and texture bytes actually held by the scene
      let geo = 0, tex = 0; const seenG = new Set(), seenT = new Set();
      G.scene.traverse((o) => {
        if (!o.isMesh && !o.isSkinnedMesh) return;
        const g = o.geometry;
        if (g && !seenG.has(g)) { seenG.add(g); for (const k in g.attributes) geo += g.attributes[k].array.byteLength; if (g.index) geo += g.index.array.byteLength; }
        if (o.isInstancedMesh) geo += o.instanceMatrix.array.byteLength + (o.instanceColor ? o.instanceColor.array.byteLength : 0);
        for (const m of [].concat(o.material)) for (const k in m) { const t = m[k]; if (t && t.isTexture && !seenT.has(t)) { seenT.add(t); const im = t.image; if (im && im.width) tex += im.width * im.height * 4 * (t.generateMipmaps ? 1.33 : 1); } }
      });
      return { zone: zi, at: x + ',' + z, calls, tris, upd: +upd.toFixed(2), geoMB: +(geo / 1048576).toFixed(1), texMB: +(tex / 1048576).toFixed(1), loaded: G.world.streamer.status().map((s) => s[0]).join(''), gpuGeo: gl.info.memory.geometries, gpuTex: gl.info.memory.textures, programs: gl.info.programs.length };
    }, [zi, x, z]));
  }
  console.log('quality', await page.evaluate(() => window.__ui().quality));
  for (const r of rows) console.log(JSON.stringify(r));
}
