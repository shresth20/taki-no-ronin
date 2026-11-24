import { Effect, EffectAttribute } from 'postprocessing';
import { Uniform, Color } from 'three';

/* Final grade: mood tint, saturation, contrast, soft highlight shoulder, vignette,
   plus the combat "impact" treatments (flash, desaturate, invert frame, chromatic split, radial speed blur). */
const frag = /* glsl */ `
uniform float uSat, uContrast, uFlash, uDesat, uAberration, uInvert, uVignette, uSpeed;
uniform vec3 uTint;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  vec3 c = inputColor.rgb;
  if (uAberration > 0.001) {
    vec2 o = d * uAberration * 0.035 * (0.35 + r2 * 3.0);
    c.r = texture2D(inputBuffer, uv + o).r;
    c.b = texture2D(inputBuffer, uv - o).b;
  }
  if (uSpeed > 0.001) {
    vec3 acc = c;
    for (int i = 1; i <= 5; i++) acc += texture2D(inputBuffer, uv - d * float(i) * 0.014 * uSpeed).rgb;
    c = mix(c, acc / 6.0, smoothstep(0.01, 0.16, r2));
  }
  c *= uTint;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat * (1.0 - uDesat));
  c = pow(max(c, 0.0) / 0.22, vec3(uContrast)) * 0.22;
  vec3 hi = max(c - 0.6, 0.0);
  c = min(c, 0.6) + 0.4 * tanh(hi / 0.4);            // soft shoulder instead of a hard clip
  c = mix(c, vec3(1.0) - c, uInvert);
  c = mix(c, vec3(1.0), clamp(uFlash, 0.0, 1.0));
  c *= mix(1.0, 1.0 - uVignette, smoothstep(0.1, 0.62, r2));
  outputColor = vec4(c, inputColor.a);
}`;

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', frag, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([
        ['uSat', new Uniform(1.1)],
        ['uContrast', new Uniform(1.05)],
        ['uFlash', new Uniform(0)],
        ['uDesat', new Uniform(0)],
        ['uAberration', new Uniform(0)],
        ['uInvert', new Uniform(0)],
        ['uVignette', new Uniform(0.4)],
        ['uSpeed', new Uniform(0)],
        ['uTint', new Uniform(new Color(1, 1, 1))],
      ]),
    });
  }
  set(name, v) {
    this.uniforms.get(name).value = v;
  }
}
