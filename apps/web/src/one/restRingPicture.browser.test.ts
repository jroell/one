import { expect, it, vi } from "vite-plus/test";

import { renderRestRing } from "./oneOrbRestRender";
import { ORB_REST } from "./oneOrbRest";
import { holdRestRing } from "./restRingPicture";
import { ONE_ORB_FRAGMENT_SHADER, ONE_ORB_VERTEX_SHADER } from "./oneOrbShader";

const colors = (index: number) => ({
  lo: `rgb(${20 + index} 20 40)`,
  mid: `rgb(${100 + index} 60 180)`,
  hi: `rgb(${180 + index} 150 240)`,
  dark: true,
  size: 48 as const,
  density: 1,
});

const loads = (url: string) =>
  fetch(url).then(
    () => true,
    () => false,
  );

it("keeps a held picture and revokes the oldest released ones past the idle limit", async () => {
  const held = holdRestRing(colors(0));
  const heldUrl = await held.picture;
  const released: string[] = [];
  for (let index = 1; index <= 9; index += 1) {
    const hold = holdRestRing(colors(index));
    released.push(await hold.picture);
    hold.release();
  }
  expect(await loads(heldUrl)).toBe(true);
  expect(await loads(released[0]!)).toBe(false);
  expect(await loads(released.at(-1)!)).toBe(true);
  held.release();
});

it("frees the GPU context when the shader fails to compile", async () => {
  const lose = vi.fn();
  const getExtension = vi
    .spyOn(WebGLRenderingContext.prototype, "getExtension")
    .mockImplementation(
      (name: string) => (name === "WEBGL_lose_context" ? { loseContext: lose } : null) as never,
    );
  const compileFails = vi
    .spyOn(WebGLRenderingContext.prototype, "getShaderParameter")
    .mockReturnValue(false);
  try {
    await expect(
      renderRestRing({
        vertex: ONE_ORB_VERTEX_SHADER,
        fragment: ONE_ORB_FRAGMENT_SHADER,
        width: 48,
        supersample: 2,
        hi: [1, 1, 1],
        mid: [0.5, 0.5, 0.5],
        lo: [0.1, 0.1, 0.1],
        dark: 1,
        glow: 0,
        rest: ORB_REST,
        quality: 1,
      }),
    ).rejects.toThrow();
    expect(lose).toHaveBeenCalledTimes(1);
  } finally {
    getExtension.mockRestore();
    compileFails.mockRestore();
  }
});
