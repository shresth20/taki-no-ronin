import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, advance } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { PerformanceMonitor } from '@react-three/drei';
import { G } from './core/state.js';
import { Game } from './game/game.js';
import { GradeEffect } from './vfx/grade.js';
import Overlay from './ui/Hud.jsx';

const NOPOST = typeof location !== 'undefined' && /[?&]nopost/.test(location.search);
const game = new Game();
if (typeof window !== 'undefined') window.__game = game;

/* Hosts the imperative game inside the R3F render loop and wires up the post-processing chain. */
function GameHost() {
  const three = useThree();
  const bloom = useRef();
  const composer = useRef();
  const grade = useMemo(() => new GradeEffect(), []);
  useEffect(() => {
    game.grade = grade;
    game.init(three).catch((e) => console.error('init failed', e));
    if (G.test) {
      // deterministic stepping for automated playtests: window.__step(dt, frames, render)
      window.__step = (dt = 1 / 30, n = 1, render = true) => {
        for (let i = 0; i < n; i++) {
          game.skipRender = !(render && i === n - 1);
          game.fixedDt = dt;
          advance(G.real + dt);
        }
        return G.real;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    game.bloom = bloom.current;
    const c = composer.current;
    game.composer = c;
    if (G.test && c && !c.__patched) {
      const render = c.render.bind(c);
      c.render = (d) => !game.skipRender && render(d);
      c.__patched = true;
    }
  });
  useFrame((_, delta) => game.update(game.fixedDt ?? delta));
  return (
    <>
      {NOPOST ? null : (
        <EffectComposer ref={composer} multisampling={0} enableNormalPass={false}>
          <Bloom ref={bloom} mipmapBlur intensity={0.6} luminanceThreshold={0.86} luminanceSmoothing={0.18} radius={0.72} />
          <primitive object={grade} dispose={null} />
        </EffectComposer>
      )}
      <PerformanceMonitor flipflops={3} onDecline={() => game.onPerf(-1)} />
    </>
  );
}

export default function App() {
  return (
    <>
      <Canvas
        flat
        dpr={[1, 2]}
        shadows="soft"
        frameloop={G.test ? 'never' : 'always'}
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false, depth: true }}
        camera={{ fov: 50, near: 0.25, far: 1600, position: [19, 5.2, 19] }}
      >
        <GameHost />
      </Canvas>
      <Overlay game={game} />
    </>
  );
}
