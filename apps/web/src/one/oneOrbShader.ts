export const ONE_ORB_VERTEX_SHADER = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/**
 * A ray-marched glass band. The cross-section is an ellipse (thin across the
 * radius, tall along the axis) so it reads as a ring rather than a donut.
 * Output is premultiplied alpha over a transparent canvas.
 */
export const ONE_ORB_FRAGMENT_SHADER = `
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform vec3 uHi;
uniform vec3 uMid;
uniform vec3 uLo;
uniform float uEnergy;
uniform float uSpin;
uniform float uTilt;
uniform float uPulse;
uniform float uDark;
uniform float uAura;
uniform float uReveal;

const float RADIUS = 1.0;
const vec2 BAND = vec2(0.085, 0.27);

/* 1 below "low", 0 above "high". smoothstep itself is undefined when its edges descend. */
float fall(float high, float low, float x) { return 1.0 - smoothstep(low, high, x); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amplitude * noise(p);
    p = p * 2.03 + vec2(17.0, 9.0);
    amplitude *= 0.5;
  }
  return sum;
}

/* Sparks that drift up past the ring, each on its own slow path. */
float embers(vec2 uv) {
  float glow = 0.0;
  for (int i = 0; i < 12; i++) {
    float seed = float(i) * 7.31;
    float speed = 0.035 + 0.05 * hash(vec2(seed, 1.0));
    float climb = fract(hash(vec2(seed, 2.0)) + uTime * speed);
    vec2 at = vec2(
      (hash(vec2(seed, 3.0)) - 0.5) * 1.5 + 0.06 * sin(uTime * 0.6 + seed),
      climb * 2.0 - 1.0
    );
    float fade = smoothstep(0.0, 0.2, climb) * fall(1.0, 0.55, climb);
    float flicker = 0.6 + 0.4 * sin(uTime * (2.0 + hash(vec2(seed, 4.0)) * 3.0) + seed);
    float size = 0.006 + 0.008 * hash(vec2(seed, 5.0));
    glow += fall(size, 0.0, length(uv - at)) * fade * flicker;
  }
  return glow;
}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec3 toRing(vec3 p) {
  p.xz = rot(uSpin) * p.xz;
  p.yz = rot(uTilt) * p.yz;
  p.xy = rot(-0.42) * p.xy;
  return p;
}

float ringDistance(vec3 p) {
  p = toRing(p);
  float angle = atan(p.z, p.x);
  float ripple = uEnergy * (0.05 * sin(angle * 3.0 + uTime * 5.0) + 0.03 * sin(angle * 7.0 - uTime * 8.0));
  vec2 q = vec2(length(p.xz) - RADIUS - ripple, p.y);
  vec2 band = BAND * (1.0 + 0.22 * uEnergy);
  return (length(q / band) - 1.0) * min(band.x, band.y);
}

vec3 ringNormal(vec3 p) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    ringDistance(p + e.xyy) - ringDistance(p - e.xyy),
    ringDistance(p + e.yxy) - ringDistance(p - e.yxy),
    ringDistance(p + e.yyx) - ringDistance(p - e.yyx)
  ));
}

/* A small studio around the ring: a wide soft box overhead, tall strip
   lights, and a tinted floor bounce. The dark gaps between the lights are
   what make the surface read as polished. */
float stripLight(vec3 d, float azimuth, float width, float low, float high) {
  float a = atan(d.x, d.z) - azimuth;
  a = abs(atan(sin(a), cos(a)));
  return fall(width, width * 0.35, a)
    * smoothstep(low, low + 0.18, d.y)
    * fall(high, high - 0.18, d.y);
}

vec3 studio(vec3 d) {
  vec3 c = mix(uLo * 0.04, uLo * 0.22, smoothstep(-1.0, 0.6, d.y));
  c += vec3(1.0) * smoothstep(0.58, 0.88, d.y) * 3.2;
  c += vec3(1.0) * stripLight(d, 0.95, 0.2, -0.5, 0.55) * 2.6;
  c += mix(uHi, vec3(1.0), 0.4) * stripLight(d, -1.25, 0.12, -0.35, 0.5) * 2.0;
  c += uHi * stripLight(d, 2.7, 0.3, -0.2, 0.5) * 1.1;
  // A slatted light wall behind the ring. The inner face of the band mirrors
  // it, which gives the streaked highlights of a polished jewel.
  float behind = smoothstep(0.05, 0.6, -d.z);
  float slats = smoothstep(0.35, 0.75, 0.5 + 0.5 * sin(atan(d.x, -d.z) * 7.0 + 0.8));
  float rise = smoothstep(-0.55, 0.15, d.y) * fall(0.95, 0.35, d.y);
  c += mix(uHi, vec3(1.0), 0.45) * behind * slats * rise * 2.1;
  c += uMid * behind * rise * 0.35;
  c += uMid * exp(-abs(d.y + 0.08) * 9.0) * 0.5;
  c += uMid * fall(-0.35, -1.0, d.y) * 0.7;
  float sweep = fall(0.2, 0.0, abs(d.x * 0.8 + d.y * 0.6 - sin(uTime * 2.4) * 1.3));
  c += vec3(1.0) * sweep * uPulse * 1.8;
  return c;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / min(uRes.x, uRes.y);
  // The opening starts far back in the dark and drifts in.
  float arrive = 1.0 - pow(1.0 - uReveal, 3.0);
  vec3 ro = vec3(0.0, 0.0, mix(5.3, 4.1, arrive));
  vec3 rd = normalize(vec3(uv * 1.2, -3.0));
  float pixel = 2.2 / min(uRes.x, uRes.y);

  float t = 2.0;
  float nearest = 1e3;
  bool hit = false;
  for (int i = 0; i < 64; i++) {
    float d = ringDistance(ro + rd * t);
    nearest = min(nearest, d);
    if (d < 0.0012) { hit = true; break; }
    t += d * 0.82;
    if (t > 7.6) break;
  }

  vec3 color = vec3(0.0);
  float alpha = 0.0;

  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = ringNormal(p);
    vec3 v = -rd;
    float facing = max(dot(n, v), 0.0);
    float fresnel = 0.06 + 0.94 * pow(1.0 - facing, 4.0);
    vec3 reflection = studio(reflect(rd, n));
    // Colored glass over a mirror: lights keep the brand hue and turn white
    // only at grazing angles.
    vec3 tint = mix(uMid, uHi, 0.25);
    vec3 mirrored = reflection * mix(tint * 1.25, vec3(1.0), fresnel);
    vec3 through = studio(refract(rd, n, 0.69)) * tint;
    vec3 depth = mix(uLo * 0.5, uMid * 0.6, facing * facing);
    color = depth * 0.5 + mirrored * 0.9 + through * 0.22;
    color += uHi * pow(1.0 - facing, 3.0) * (0.3 + 0.6 * uEnergy);
    vec3 keyHalf = normalize(normalize(vec3(0.35, 0.9, 0.55)) + v);
    color += vec3(1.0) * pow(max(dot(n, keyHalf), 0.0), 140.0) * 2.4;
    color = color / (1.0 + color * 0.36);
    color = pow(color, vec3(0.82));
    // Opening: the metal stays black until a line of fire has run around the
    // band. The body resolves behind the flame front.
    float around = fract(atan(toRing(p).z, toRing(p).x) / 6.2831853 + 0.25);
    float front = uReveal * 1.5;
    float lit = smoothstep(front - 0.42, front - 0.02, around);
    float settled = smoothstep(0.55, 1.0, uReveal);
    color *= mix(1.0 - lit, 1.0, settled) * mix(0.0, 1.0, smoothstep(0.02, 0.2, uReveal));
    float flame = fall(0.07, 0.0, abs(around - front)) * (1.0 - settled);
    color += mix(uHi, vec3(1.0), 0.6) * flame * 2.2;
    color += uMid * (1.0 - lit) * pow(1.0 - facing, 2.0) * (1.0 - settled) * 0.9;
    alpha = 1.0;
  }

  float edge = hit ? 1.0 : fall(pixel, 0.0, nearest);
  if (!hit && edge > 0.0) {
    color = mix(uMid, uHi, 0.5);
    alpha = edge;
  }

  float halo = exp(-max(nearest, 0.0) * (7.5 - 3.0 * uEnergy)) * (0.16 + 0.34 * uEnergy + 0.1 * uPulse);
  // A corona that moves like slow smoke: light drawn up and off the band.
  // Two layers sliding past each other, so the smoke curls instead of scrolling.
  vec2 drift = uv * 2.1 + vec2(0.0, -uTime * 0.16);
  float smoke = fbm(drift + 0.9 * vec2(fbm(drift * 0.7 + uTime * 0.05), fbm(drift * 0.7 - uTime * 0.04)));
  float corona = exp(-max(nearest, 0.0) * 2.6) * smoothstep(0.32, 0.85, smoke) * uAura;
  halo = halo * mix(1.0, 0.55 + 0.9 * smoke, uAura) + corona * 0.42;
  halo += embers(uv) * uAura * 0.9;
  halo *= smoothstep(0.0, 0.5, uReveal);
  halo *= mix(0.55, 1.0, uDark);
  // The glow must reach zero before the edge of the canvas, or the square shows.
  halo *= fall(1.0, 0.62, length(uv));
  vec3 haloColor = mix(uMid, uHi, 0.35);
  float outAlpha = alpha + (1.0 - alpha) * halo;
  vec3 outColor = color * alpha + haloColor * halo * (1.0 - alpha);
  gl_FragColor = vec4(outColor, outAlpha);
}
`;
