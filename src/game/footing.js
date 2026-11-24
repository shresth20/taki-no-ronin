import { bodyGroundAt } from '../world/nav.js';

/* Where a body is carried over the ground. Its root follows a slope or a flight of stairs exactly (nav.bodyGroundAt
   takes a stair as one smooth incline; the feet find the treads themselves, chars/character.js footContact), eases up
   onto a step it meets (a stone, a floor) instead of popping up, settles onto a lower one, and only a real drop is a
   fall under gravity.                                                                                              */
const GRAV = 27;
export class Footing {
  constructor() {
    this.y = NaN; // the root's ground height
    this.g = NaN; // the ground under it last frame
    this.vy = 0;
  }
  reset(x, z) {
    this.y = this.g = bodyGroundAt(x, z);
    this.vy = 0;
    return this.y;
  }
  /** moved: how far the body travelled across the ground this frame */
  update(x, z, dt, moved = 0) {
    const g = bodyGroundAt(x, z);
    if (!(this.y === this.y) || dt <= 0) { this.y = this.g = g; this.vy = 0; return g; }
    // the ground running on under the body (a slope, an incline) is followed as it goes, with no lag;
    // what is left over is a step, taken over a few frames
    const dg = g - this.g;
    this.g = g;
    if (Math.abs(dg) < 0.05 + moved * 0.75 && this.vy === 0) this.y += dg;
    const d = g - this.y;
    if (d >= 0) {
      this.vy = 0;
      this.y = d < 0.004 ? g : this.y + d * (1 - Math.exp(-dt * 22));
    } else if (d > -0.6 && this.vy === 0) {
      this.y = d > -0.004 ? g : this.y + d * (1 - Math.exp(-dt * 16));
    } else {
      // off an edge: fall until the ground catches the body
      this.vy -= GRAV * dt;
      this.y += this.vy * dt;
      if (this.y <= g) { this.y = g; this.vy = 0; }
    }
    return this.y;
  }
}
