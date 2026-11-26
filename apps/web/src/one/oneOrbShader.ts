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
uniform float uGlow;
uniform float uOrbit;

const float RADIUS = 1.0;
const vec2 BAND = vec2(0.15, 0.14);
const float ROLL = 0.17;
/* Sets where the body's mid-tone lands: the standard gold ramp's 500 step. */
const float EXPOSURE = 0.88;
/* Where on the band the catch-light sits at rest, in radians around the ring. */
const float GLINT_AT = 5.75;

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
  // The turn on screen comes first, so the ring leans the way the mark's silhouette does.
  p.xy = rot(ROLL) * p.xy;
  p.xz = rot(uSpin) * p.xz;
  p.yz = rot(uTilt) * p.yz;
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
  // Every light is the brand's own warm white: a pure white reflected off gold reads as grey.
  vec3 warm = mix(uHi, vec3(1.0), 0.22);
  vec3 c = mix(uLo * mix(0.035, 0.012, uDark), uLo * mix(0.2, 0.1, uDark), smoothstep(-1.0, 0.6, d.y));
  c += warm * smoothstep(0.58, 0.88, d.y) * 3.4;
  c += warm * stripLight(d, -0.95, 0.2, -0.5, 0.55) * 3.6;
  c += warm * stripLight(d, 1.25, 0.12, -0.35, 0.5) * 1.4;
  c += uHi * stripLight(d, 2.7, 0.3, -0.2, 0.5) * 1.1;
  // A slatted light wall behind the ring. The inner face of the band mirrors
  // it, which gives the streaked highlights of a polished jewel.
  float behind = smoothstep(0.05, 0.6, -d.z);
  float slats = smoothstep(0.12, 0.88, 0.5 + 0.5 * sin(atan(d.x, -d.z) * 5.0 + 0.8));
  float rise = smoothstep(-0.55, 0.15, d.y) * fall(0.95, 0.35, d.y);
  c += warm * behind * slats * rise * 2.1;
  c += uMid * behind * rise * 0.35;
  c += uMid * exp(-abs(d.y + 0.08) * 9.0) * 0.5;
  c += uMid * fall(-0.35, -1.0, d.y) * 0.7;
  float sweep = fall(0.2, 0.0, abs(d.x * 0.8 + d.y * 0.6 - sin(uTime * 2.4) * 1.3));
  c += warm * sweep * uPulse * 1.8;
  return c;
}

/* Rolls light off without changing its hue. Rolling each channel on its own lets red and green
   clip together, and gold turns lime. The brightest channel is compressed, the rest follow it,
   and only a hot highlight is allowed to drift toward white. */
vec3 rollOff(vec3 c) {
  float m = max(c.r, max(c.g, c.b));
  float rolled = m / (1.0 + m * 0.42);
  c *= rolled / max(m, 1e-4);
  float peak = max(c.r, max(c.g, c.b));
  c /= max(1.0, peak);
  float white = smoothstep(1.6, 4.0, m) * 0.3;
  return mix(c, vec3(max(c.r, max(c.g, c.b))), white);
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / min(uRes.x, uRes.y);
  // The opening starts far back in the dark and drifts in.
  float arrive = 1.0 - pow(1.0 - uReveal, 3.0);
  vec3 ro = vec3(0.0, 0.0, mix(5.3, 3.8, arrive));
  vec3 rd = normalize(vec3(uv * 1.2, -3.0));
  float pixel = 2.2 / min(uRes.x, uRes.y);

  // Nothing is drawn outside this circle (the glow has faded to zero there),
  // so those pixels skip the march and the smoke entirely.
  if (length(uv) > 1.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

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
    float facing = clamp(dot(n, v), 0.0, 1.0);
    float fresnel = 0.06 + 0.94 * pow(1.0 - facing, 4.0);
    vec3 reflection = studio(reflect(rd, n));
    // Colored glass over a mirror: lights keep the brand hue and turn white
    // only at grazing angles.
    vec3 tint = mix(uMid, uHi, 0.25);
    vec3 mirrored = reflection * mix(tint * 1.25, mix(uHi, vec3(1.0), 0.3), fresnel);
    vec3 through = studio(refract(rd, n, 0.69)) * tint;
    vec3 depth = mix(uLo * 0.5, uMid * 0.6, facing * facing);
    color = depth * 0.5 + mirrored * 0.9 + through * 0.22;
    color += uHi * pow(1.0 - facing, 3.0) * (0.3 + 0.6 * uEnergy);
    vec3 keyHalf = normalize(normalize(vec3(0.35, 0.9, 0.55)) + v);
    // A soft key light, not a pin: a tight exponent sparkles along the rim as the normal turns.
    color += mix(uHi, vec3(1.0), 0.6) * pow(max(dot(n, keyHalf), 0.0), 36.0) * 0.9;
    // The catch-light rides the band: a short specular where the outer top of the section
    // faces the camera, at a place that turns once every uOrbit cycle. At rest it sits at one
    // o'clock, which is where the static picture has it.
    vec3 ringAt = toRing(p);
    vec3 ringNormal = toRing(p + n) - ringAt;
    float glintGap = atan(ringAt.z, ringAt.x) - (GLINT_AT + 6.2831853 * uOrbit);
    glintGap = atan(sin(glintGap), cos(glintGap));
    vec3 rimUp = normalize(vec3(cos(atan(ringAt.z, ringAt.x)), 1.0, sin(atan(ringAt.z, ringAt.x))));
    float glint = exp(-glintGap * glintGap / 0.035) * pow(max(dot(ringNormal, rimUp), 0.0), 7.0)
      * smoothstep(0.15, 0.55, facing);
    color += mix(uHi, vec3(1.0), 0.7) * glint * 4.2;
    color *= EXPOSURE;
    color = rollOff(color);
    // The theme colors arrive in linear light; this takes them most of the way back to what a screen shows.
    color = pow(color, vec3(0.45));
    // A shallow S-curve: deeper shade and cleaner lights, so the band keeps its form.
    color = mix(color, color * color * (3.0 - 2.0 * color), 0.6);
    // Gold keeps its saturation through the tone curve, so it never settles into bronze.
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    // Lights drift toward the ramp's pale gold, not toward yellow.
    color = clamp(mix(vec3(luma), color, 1.0 - 0.4 * smoothstep(0.55, 0.95, luma)), 0.0, 1.0);
    // Opening: the metal stays dark until fire has run around the band. It starts at one point
    // and runs both ways, so the two fronts meet on the far side and there is no seam where lit
    // metal would sit against unlit. The body resolves behind each front.
    float turn = fract(atan(toRing(p).z, toRing(p).x) / 6.2831853 + 0.25);
    float around = 1.0 - abs(turn * 2.0 - 1.0);
    float front = uReveal * 1.5;
    float lit = smoothstep(front - 0.42, front - 0.02, around);
    float settled = smoothstep(0.55, 1.0, uReveal);
    // Unlit metal keeps a trace of rim light, so the band reads as dark metal, not a hole.
    float unlit = mix(1.0 - lit * 0.94, 1.0, settled);
    color *= unlit * mix(0.0, 1.0, smoothstep(0.02, 0.2, uReveal));
    float flame = fall(0.07, 0.0, abs(around - front)) * (1.0 - settled);
    // The fire takes the theme's color: a white-hot core in a wider, softer bloom of the tint.
    float bloom = fall(0.2, 0.0, abs(around - front)) * (1.0 - settled);
    color += mix(uHi, vec3(1.0), 0.4) * flame * 2.0;
    color += uMid * bloom * bloom * 0.55;
    color += uMid * (1.0 - lit) * pow(1.0 - facing, 2.0) * (1.0 - settled) * 0.9;
    // The flame is the brightest thing in the opening; roll it off so it glows instead of
    // clipping to flat white. Once the ring has settled it is already in display range, and
    // rolling it off again would cap its brightest light at 70%.
    color = mix(rollOff(color), color, settled);
    alpha = 1.0;
  }

  float edge = hit ? 1.0 : fall(pixel, 0.0, nearest);
  if (!hit && edge > 0.0) {
    color = mix(uMid, uHi, 0.5);
    alpha = edge;
  }

  // At rest the light around the ring is a soft contact glow, close to the band and gone a short
  // way out, so it never reads as an outline. The slow smoke and embers belong to the lit states
  // (aura above its idle level), and a small ring has no glow at all.
  float halo;
  float alive = smoothstep(0.35, 0.6, uAura);
  float contact = exp(-max(nearest, 0.0) * 16.0) * 0.07 * uGlow;
  float spread = exp(-max(nearest, 0.0) * (7.5 - 3.0 * uEnergy)) * (0.1 * uEnergy + 0.1 * uPulse + 0.16 * alive);
  halo = contact + spread * uGlow;
  // A corona that moves like slow smoke: light drawn up and off the band.
  // Two layers sliding past each other, so the smoke curls instead of scrolling.
  vec2 drift = uv * 2.1 + vec2(0.0, -uTime * 0.16);
  float smoke = fbm(drift + 0.9 * vec2(fbm(drift * 0.7 + uTime * 0.05), fbm(drift * 0.7 - uTime * 0.04)));
  float corona = exp(-max(nearest, 0.0) * 2.6) * smoothstep(0.32, 0.85, smoke) * uAura * alive;
  halo = halo * mix(1.0, 0.55 + 0.9 * smoke, alive) + corona * 0.42 * uGlow;
  halo += embers(uv) * uAura * alive * 0.9;
  halo *= smoothstep(0.0, 0.5, uReveal);
  halo *= uDark;
  // The glow must reach zero before the edge of the canvas, or the square shows.
  halo *= fall(1.0, 0.62, length(uv));
  vec3 haloColor = mix(uMid, uHi, 0.35);
  // On a pale page a glow is invisible and only dirties the edge. The ring instead casts a soft
  // warm shadow, heavier toward its lower side, so it sits on the page.
  float below = smoothstep(0.35, -0.65, uv.y / 0.65);
  float shadow = (1.0 - uDark) * exp(-max(nearest, 0.0) * 6.0) * (0.05 + 0.12 * below);
  // Inside the opening the page shows through clean: find where this ray crosses the band's plane.
  vec3 planeO = toRing(ro);
  vec3 planeD = toRing(ro + rd) - planeO;
  float planeT = -planeO.y / (abs(planeD.y) < 1e-4 ? 1e-4 : planeD.y);
  vec3 planeAt = planeO + planeD * planeT;
  float opening = fall(RADIUS - 0.06, RADIUS - 0.2, length(planeAt.xz));
  shadow *= (1.0 - opening) * fall(1.0, 0.62, length(uv));
  float outAlpha = alpha + (1.0 - alpha) * (halo + shadow);
  vec3 outColor = color * alpha + (haloColor * halo + uLo * 0.12 * shadow) * (1.0 - alpha);
  gl_FragColor = vec4(outColor, outAlpha);
}
`;
