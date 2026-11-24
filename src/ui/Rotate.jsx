import { useEffect, useState } from 'react';
import { G, useUI, getUI } from '../core/state.js';

/* The game is laid out for a landscape screen only. On a touch device held upright, a gate covers everything and
   pauses play until the device is turned. Where the browser allows it (Android Chrome, in fullscreen), we also lock
   the screen to landscape once play begins. */
const portraitQuery = typeof matchMedia !== 'undefined' ? matchMedia('(orientation: portrait)') : null;
const coarse = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const canLock = () => typeof document !== 'undefined' && !!document.documentElement.requestFullscreen && typeof screen !== 'undefined' && !!screen.orientation?.lock;

/** Go fullscreen and lock to landscape on phones and tablets. Call it from a tap: browsers only allow it in a gesture. */
export async function lockLandscape() {
  if (!coarse() || !canLock()) return false;
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    await screen.orientation.lock('landscape');
    return true;
  } catch {
    return false;
  }
}

export default function RotateGate() {
  const isTouch = useUI((s) => s.isTouch);
  const phase = useUI((s) => s.phase);
  const [portrait, setPortrait] = useState(() => !!portraitQuery?.matches);
  useEffect(() => {
    if (!portraitQuery) return undefined;
    const on = () => setPortrait(portraitQuery.matches);
    portraitQuery.addEventListener('change', on);
    return () => portraitQuery.removeEventListener('change', on);
  }, []);
  const gated = isTouch && portrait;
  // pause mid-play (and on any later phase change while upright); the player resumes from the pause sheet once
  // the device is sideways again. togglePause ignores the title and end screens, which need no pausing.
  useEffect(() => {
    if (gated && !getUI().paused) G.director?.togglePause(true);
  }, [gated, phase]);
  if (!gated) return null;
  return (
    <div className="rotate" role="alertdialog" aria-labelledby="rotate-title">
      <div className="rotate-phone" aria-hidden="true" />
      <p id="rotate-title" className="rotate-title"><span aria-hidden="true">横</span> Turn your device sideways</p>
    </div>
  );
}
