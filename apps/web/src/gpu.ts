/**
 * True when WebGL is backed by a software rasteriser (SwiftShader, llvmpipe): machines without GPU acceleration
 * and CI runners. There, MediaPipe's GPU delegate is far slower than its CPU delegate (about 1 fps versus 5+), and
 * real-time shadows cost seconds per frame. Works in windows and workers alike.
 */
export function isSoftwareRenderer(): boolean {
  try {
    const gl = new OffscreenCanvas(1, 1).getContext("webgl2");
    if (!gl) return true;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(
      info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /swiftshader|llvmpipe|software|basic render/i.test(renderer);
  } catch {
    return true;
  }
}
