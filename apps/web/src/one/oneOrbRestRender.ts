/**
 * Draws the ring's rest pose into a picture. scripts/render-mark.mjs runs this exact function in
 * Chromium to write public/mark, and the app runs it for a chosen theme's colors, so a themed
 * picture and the gold ones come from one piece of code. It uses nothing outside itself, because
 * the script sends its source to the page.
 */
export interface RestRingJob {
  readonly vertex: string;
  readonly fragment: string;
  /** Pixel width of the picture. */
  readonly width: number;
  readonly supersample: number;
  /** Shader colors: sRGB bytes raised to 2.2, as the live ring reads its theme colors. */
  readonly hi: readonly number[];
  readonly mid: readonly number[];
  readonly lo: readonly number[];
  readonly dark: number;
  readonly glow: number;
  readonly rest: Readonly<
    Record<"time" | "spin" | "tilt" | "pulse" | "energy" | "aura" | "reveal" | "orbit", number>
  >;
  readonly quality: number;
  /** Rim and halo level, 0 to 1. Absent means 0, the shipped picture. */
  readonly level?: number;
}

export async function renderRestRing(job: RestRingJob): Promise<Blob> {
  const big = document.createElement("canvas");
  big.width = job.width * job.supersample;
  big.height = big.width;
  const gl = big.getContext("webgl", {
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error("no WebGL in this browser");
  const held: Array<() => void> = [];
  try {
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("no shader");
      held.push(() => gl.deleteShader(shader));
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) ?? "shader failed");
      }
      return shader;
    };
    const program = gl.createProgram();
    held.push(() => gl.deleteProgram(program));
    gl.attachShader(program, compile(gl.VERTEX_SHADER, job.vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, job.fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("program failed to link");
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    held.push(() => gl.deleteBuffer(buffer));
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const at = (name: string) => gl.getUniformLocation(program, name);
    gl.viewport(0, 0, big.width, big.height);
    gl.uniform2f(at("uRes"), big.width, big.height);
    gl.uniform3fv(at("uHi"), [...job.hi]);
    gl.uniform3fv(at("uMid"), [...job.mid]);
    gl.uniform3fv(at("uLo"), [...job.lo]);
    gl.uniform1f(at("uDark"), job.dark);
    gl.uniform1f(at("uGlow"), job.glow);
    gl.uniform1f(at("uTime"), job.rest.time);
    gl.uniform1f(at("uSpin"), job.rest.spin);
    gl.uniform1f(at("uTilt"), job.rest.tilt);
    gl.uniform1f(at("uPulse"), job.rest.pulse);
    gl.uniform1f(at("uEnergy"), job.rest.energy);
    gl.uniform1f(at("uLevel"), job.level ?? 0);
    gl.uniform1f(at("uAura"), job.rest.aura);
    gl.uniform1f(at("uReveal"), job.rest.reveal);
    gl.uniform1f(at("uOrbit"), job.rest.orbit);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const small = document.createElement("canvas");
    small.width = job.width;
    small.height = job.width;
    const context = small.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "low";
    context.drawImage(big, 0, 0, job.width, job.width);
    const blob = await new Promise<Blob | null>((done) =>
      small.toBlob(done, "image/webp", job.quality),
    );
    if (!blob) throw new Error("could not encode the ring");
    return blob;
  } finally {
    // Every exit frees what it made, then the context itself: a failed or discarded picture must not hold the GPU.
    for (const release of held.reverse()) release();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
