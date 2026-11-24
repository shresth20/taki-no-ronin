import { useEffect, useRef, useState } from 'react';
import { G, useUI, ui } from '../core/state.js';
import { input } from '../core/input.js';
import { CAM_VIEWS } from '../game/camera.js';
import WorldMap from './WorldMap.jsx';
import Debug from './Debug.jsx';
import RotateGate, { lockLandscape } from './Rotate.jsx';

const D = () => G.director;
const setCamView = (v) => { ui({ camView: v }); try { localStorage.setItem('tnr-camview', v); } catch { /* storage is optional */ } };
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* ---------- title ---------- */
function Title({ game }) {
  const phase = useUI((s) => s.phase);
  const quality = useUI((s) => s.quality);
  const sound = useUI((s) => s.sound);
  const isTouch = useUI((s) => s.isTouch);
  const hasSave = useUI((s) => s.hasSave);
  const loading = phase === 'loading';
  return (
    <div className="title">
      <div className="title-kanji" aria-hidden="true">滝の浪人</div>
      <div className="title-main">
        <p className="eyebrow">A samurai's road in six lands</p>
        <h1>Taki no Ronin</h1>
        <p className="lede">From the falls, through village, bamboo and temple, to the castle of the Black Fang.</p>
        <div className="title-actions">
          {hasSave && !loading && (
            <button id="continue" className="btn-primary" onClick={() => { lockLandscape(); D()?.begin(true); }}>Continue</button>
          )}
          <button id="begin" className={hasSave && !loading ? 'btn-ghost big' : 'btn-primary'} disabled={loading} onClick={() => { lockLandscape(); D()?.begin(false); }}>
            {loading ? 'Painting the valley…' : hasSave ? 'New journey' : 'Begin'}
          </button>
          <div className="seg" role="group" aria-label="Graphics quality">
            {['low', 'medium', 'high'].map((q) => (
              <button key={q} id={`q-${q}`} className={quality === q ? 'on' : ''} disabled={loading} onClick={() => game.setQuality(q)}>
                {q}
              </button>
            ))}
          </div>
          <button id="sound-title" className="btn-ghost" onClick={() => { ui({ sound: !sound }); G.audio?.setEnabled(!sound); }}>
            Sound {sound ? 'on' : 'off'}
          </button>
        </div>
        <ul className="keys">
          {isTouch ? (
            <>
              <li><b>Left thumb</b> move · <b>drag screen</b> turn view · <b>pinch</b> zoom</li>
              <li><b>地</b> journey map</li>
              <li><b>斬 剛</b> attack · heavy</li>
              <li><b>避 防 跳</b> dodge · block · jump</li>
              <li><b>奥義</b> special when ki is full</li>
            </>
          ) : (
            <>
              <li><b>WASD</b> move</li>
              <li><b>Click / J</b> attack · <b>Right click / K</b> heavy</li>
              <li><b>Shift</b> dodge · <b>F</b> block / parry · <b>Space</b> jump</li>
              <li><b>E</b> special when ki is full · <b>M</b> map · <b>P</b> pause</li>
              <li><b>Two-finger swipe</b> turn view · <b>Pinch / wheel</b> zoom · <b>C</b> reset view</li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
}

/* ---------- cinematic chrome ---------- */
function Cinema() {
  const letterbox = useUI((s) => s.letterbox);
  const subtitle = useUI((s) => s.subtitle);
  const caption = useUI((s) => s.caption);
  const canSkip = useUI((s) => s.canSkip);
  const phase = useUI((s) => s.phase);
  const isTouch = useUI((s) => s.isTouch);
  const zoneCard = useUI((s) => s.zoneCard);
  return (
    <>
      <div className={`bars ${letterbox ? 'on' : ''}`} aria-hidden="true"><i /><i /></div>
      {caption && (
        <div className="caption" key={caption.id}>
          <span className="caption-kanji">{caption.kanji}</span>
          <span className="caption-text">{caption.text}</span>
        </div>
      )}
      {subtitle && <p className="subtitle" key={subtitle}>{subtitle}</p>}
      {zoneCard && phase !== 'title' && (
        <div className="zonecard" key={zoneCard.id}>
          <span className="zc-kanji">{zoneCard.kanji}</span>
          <span className="zc-name">{zoneCard.name}</span>
          <span className="zc-sub">{zoneCard.sub}</span>
        </div>
      )}
      {canSkip && (phase === 'intro' || phase === 'ambush' || phase === 'training') && (
        <button id="skip" className={`skip ${isTouch && phase === 'training' ? 'top' : ''}`} onClick={() => D()?.skip()}>
          {phase === 'training' ? 'Skip training' : 'Skip'} <span aria-hidden="true">▸</span>
        </button>
      )}
    </>
  );
}

/* ---------- combat HUD ---------- */
function Bars() {
  const hp = useUI((s) => s.hp), hpMax = useUI((s) => s.hpMax), ki = useUI((s) => s.ki);
  const [lag, setLag] = useState(hp);
  useEffect(() => {
    const t = setTimeout(() => setLag(hp), 380);
    return () => clearTimeout(t);
  }, [hp]);
  return (
    <div className="vitals">
      <div className="who"><span className="who-kanji">浪人</span><span>Ronin</span></div>
      <div className="bar hp" role="meter" aria-label="Health" aria-valuemin={0} aria-valuemax={hpMax} aria-valuenow={Math.round(hp)}>
        <i className="lag" style={{ width: `${(Math.max(lag, hp) / hpMax) * 100}%` }} />
        <i className="fill" style={{ width: `${(hp / hpMax) * 100}%` }} />
      </div>
      <div className={`bar ki ${ki >= 100 ? 'full' : ''}`} role="meter" aria-label="Ki" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ki}>
        <i className="fill" style={{ width: `${ki}%` }} />
      </div>
    </div>
  );
}
function Combo() {
  const combo = useUI((s) => s.combo), at = useUI((s) => s.comboAt);
  if (combo < 2) return null;
  const word = combo >= 30 ? 'Peerless' : combo >= 20 ? 'Flowing' : combo >= 12 ? 'Keen' : combo >= 6 ? 'Sharp' : '';
  return (
    <div className="combo" key={at}>
      <b>{combo}</b>
      <span>hits</span>
      {word && <em>{word}</em>}
    </div>
  );
}
function Boss() {
  const boss = useUI((s) => s.boss);
  if (!boss) return null;
  return (
    <div className="boss">
      <span>{boss.name}</span>
      <div className="bar"><i className="fill" style={{ width: `${(boss.hp / boss.hpMax) * 100}%` }} /></div>
    </div>
  );
}
function Toast() {
  const toast = useUI((s) => s.toast);
  if (!toast) return null;
  return <div className={`toast ${toast.tone}`} key={toast.id}>{toast.text}</div>;
}
function Prompt() {
  const p = useUI((s) => s.prompt);
  const isTouch = useUI((s) => s.isTouch);
  if (!p) return null;
  const hint = [isTouch ? '斬' : 'Click or J', isTouch ? '剛' : 'Right click or K', isTouch ? '避' : 'Shift', isTouch ? '防 (hold)' : 'F (hold)'][p.step];
  return (
    <div className="prompt">
      <span className="prompt-step">Training {p.step + 1} / {p.steps}</span>
      <strong>{p.title}</strong>
      <p>{p.text}</p>
      <div className="prompt-foot">
        <kbd>{hint}</kbd>
        <span className="pips">{Array.from({ length: p.total }, (_, i) => <i key={i} className={i < p.done ? 'on' : ''} />)}</span>
      </div>
    </div>
  );
}
function Hud() {
  const wave = useUI((s) => s.wave), waves = useUI((s) => s.waves), left = useUI((s) => s.enemiesLeft), phase = useUI((s) => s.phase);
  const hurtAt = useUI((s) => s.hurtAt);
  const objective = useUI((s) => s.objective);
  const show = phase === 'combat' || phase === 'training' || phase === 'explore';
  return (
    <>
      {hurtAt > 0 && <div className="hurt" key={hurtAt} aria-hidden="true" />}
      <div className={`hud ${show ? 'on' : ''}`}>
        <Bars />
        <div className="hud-right">
          {phase === 'combat' && (
            <div className="wave">{waves > 1 && <span>Wave {wave} / {waves}</span>}<b>{left}</b><span>{left === 1 ? 'foe' : 'foes'}</span></div>
          )}
          <button id="map" className="icon-btn map-btn" aria-label="Journey map" onClick={() => D()?.toggleMap()}>地</button>
          <button id="pause" className="icon-btn" aria-label="Pause" onClick={() => D()?.togglePause()}><i /><i /></button>
        </div>
        <Combo />
        <Boss />
        <Prompt />
        {phase === 'explore' && objective && <p className="objective"><span>目的</span>{objective}</p>}
      </div>
      <Toast />
    </>
  );
}

/* ---------- touch controls ---------- */
const BUTTONS = [
  { id: 'attack', kanji: '斬', label: 'Attack', cls: 'b-attack' },
  { id: 'heavy', kanji: '剛', label: 'Heavy', cls: 'b-heavy' },
  { id: 'dodge', kanji: '避', label: 'Dodge', cls: 'b-dodge' },
  { id: 'jump', kanji: '跳', label: 'Jump', cls: 'b-jump' },
  { id: 'block', kanji: '防', label: 'Block', cls: 'b-block' },
  { id: 'special', kanji: '奥義', label: 'Special', cls: 'b-special' },
];
function Touch() {
  const phase = useUI((s) => s.phase);
  const ki = useUI((s) => s.ki);
  const paused = useUI((s) => s.paused);
  const isTouch = useUI((s) => s.isTouch);
  const stick = useRef(null), knob = useRef(null), base = useRef(null);
  const st = useRef({ id: null, ox: 0, oy: 0, lookId: null, lx: 0, ly: 0 });
  const show = isTouch && (phase === 'combat' || phase === 'training' || phase === 'explore') && !paused;
  useEffect(() => {
    if (!show) { input.move.x = input.move.y = 0; input.held.block = false; st.current.id = st.current.lookId = null; }
  }, [show]);
  if (!show) return null;
  const R = 54;
  const stickDown = (e) => {
    const s = st.current;
    if (s.id !== null) return;
    s.id = e.pointerId;
    s.ox = e.clientX; s.oy = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const r = stick.current.getBoundingClientRect();
    base.current.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
    base.current.classList.add('on');
    knob.current.style.transform = 'translate(0px, 0px)';
  };
  const stickMove = (e) => {
    const s = st.current;
    if (e.pointerId !== s.id) return;
    let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
    const l = Math.hypot(dx, dy);
    if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
    knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
    const m = Math.hypot(dx, dy) / R; // 0..1 with a small dead zone
    const k = m < 0.14 ? 0 : (m - 0.14) / 0.86;
    input.move.x = m ? (dx / R / m) * k : 0;
    input.move.y = m ? (-dy / R / m) * k : 0;
  };
  const stickUp = (e) => {
    const s = st.current;
    if (e.pointerId !== s.id) return;
    s.id = null;
    input.move.x = input.move.y = 0;
    base.current.classList.remove('on');
  };
  return (
    <div className="touch">
      <div className="stick-zone" ref={stick} onPointerDown={stickDown} onPointerMove={stickMove} onPointerUp={stickUp} onPointerCancel={stickUp}>
        <div className="stick-base" ref={base}><div className="stick-knob" ref={knob} /></div>
        <div className="stick-ghost" aria-hidden="true" />
      </div>
      <div className="pad">
        {BUTTONS.map((b) => (
          <button
            key={b.id}
            id={`btn-${b.id}`}
            className={`tb ${b.cls} ${b.id === 'special' && ki >= 100 ? 'ready' : ''}`}
            aria-label={b.label}
            style={b.id === 'special' ? { '--ki': `${ki}%` } : undefined}
            onPointerDown={(e) => { e.preventDefault(); e.currentTarget.classList.add('down'); e.currentTarget.setPointerCapture?.(e.pointerId); input.press(b.id); }}
            onPointerUp={(e) => { e.currentTarget.classList.remove('down'); input.release(b.id); }}
            onPointerCancel={(e) => { e.currentTarget.classList.remove('down'); input.release(b.id); }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="tb-kanji">{b.kanji}</span>
            <span className="tb-label">{b.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- overlays ---------- */
function Pause({ game }) {
  const paused = useUI((s) => s.paused), quality = useUI((s) => s.quality), sound = useUI((s) => s.sound);
  const camView = useUI((s) => s.camView);
  const map = useUI((s) => s.map);
  if (!paused || map) return null;
  return (
    <div className="sheet">
      <div className="panel">
        <h2><span>一時停止</span> Paused</h2>
        <button id="resume" className="btn-primary" onClick={() => D()?.togglePause()}>Resume</button>
        <div className="row"><span>Graphics</span>
          <div className="seg">{['low', 'medium', 'high'].map((q) => <button key={q} id={`pq-${q}`} className={quality === q ? 'on' : ''} onClick={() => game.setQuality(q)}>{q}</button>)}</div>
        </div>
        <div className="row"><span>Camera</span>
          <div className="seg" role="group" aria-label="Camera view">{Object.entries(CAM_VIEWS).map(([id, v]) => <button key={id} id={`cam-${id}`} className={camView === id ? 'on' : ''} onClick={() => setCamView(id)}>{v.label}</button>)}</div>
        </div>
        <div className="row"><span>Sound</span>
          <div className="seg"><button id="snd-on" className={sound ? 'on' : ''} onClick={() => { ui({ sound: true }); G.audio?.setEnabled(true); }}>on</button><button id="snd-off" className={!sound ? 'on' : ''} onClick={() => { ui({ sound: false }); G.audio?.setEnabled(false); }}>off</button></div>
        </div>
        <button id="restart" className="btn-ghost" onClick={() => { ui({ paused: false }); D()?.restart(); }}>Return to title</button>
      </div>
    </div>
  );
}
function Result() {
  const phase = useUI((s) => s.phase), stats = useUI((s) => s.stats);
  if (phase === 'defeat') {
    return (
      <div className="sheet dark">
        <div className="panel center">
          <h2><span>敗北</span> Defeated</h2>
          <p className="lede">The road remembers where you last rested. Rise there, and go on.</p>
          <button id="retry" className="btn-primary" onClick={() => D()?.retry()}>Rise again</button>
          <button id="to-title" className="btn-ghost" onClick={() => D()?.restart()}>Return to title</button>
        </div>
      </div>
    );
  }
  if (phase !== 'victory' || !stats) return null;
  return (
    <div className="result">
      <div className="rank" aria-label={`Rank ${stats.rank}`}>{stats.rank}</div>
      <dl>
        <div><dt>Time</dt><dd>{fmtTime(stats.time)}</dd></div>
        <div><dt>Longest combo</dt><dd>{stats.maxCombo}</dd></div>
        <div><dt>Parries</dt><dd>{stats.parries}</dd></div>
        <div><dt>Perfect dodges</dt><dd>{stats.perfect}</dd></div>
        <div><dt>Damage taken</dt><dd>{Math.round(stats.damage)}</dd></div>
        <div><dt>Falls</dt><dd>{stats.deaths}</dd></div>
      </dl>
      <button id="again" className="btn-primary" onClick={() => D()?.restart()}>Play again</button>
    </div>
  );
}

export default function Overlay({ game }) {
  const phase = useUI((s) => s.phase);
  const map = useUI((s) => s.map);
  if (phase === 'debug') return null;
  return (
    <div className="ui" onContextMenu={(e) => e.preventDefault()}>
      {(phase === 'title' || phase === 'loading') && <Title game={game} />}
      <Cinema />
      <Hud />
      <Touch />
      <Result />
      <Pause game={game} />
      {G.dev && !map && (phase === 'title' || phase === 'intro' || phase === 'ambush') && (
        <button id="dev-map" className="dev-pill" onClick={() => D()?.toggleMap(true)}>Dev · 地 jump map <kbd>M</kbd></button>
      )}
      {map && <WorldMap onClose={() => D()?.toggleMap(false)} />}
      <Debug />
      <RotateGate />
    </div>
  );
}
