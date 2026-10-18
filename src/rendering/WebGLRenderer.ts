/** @license SPDX-License-Identifier: Apache-2.0 */
import { Config } from "../core/Config";

const PARTICLE_VERTEX = `#version 300 es
in vec2 a_position; in vec4 a_color; in float a_size; in float a_depth;
out vec4 v_color; out float v_depth;
void main(){
  gl_Position=vec4(a_position.x*2.0-1.0, 1.0-a_position.y*2.0, 0.0, 1.0);
  gl_PointSize=clamp(a_size,1.0,20.0);
  v_color=a_color; v_depth=a_depth;
}`;
const PARTICLE_FRAGMENT = `#version 300 es
precision highp float; in vec4 v_color; in float v_depth; out vec4 outColor;
void main(){
  vec2 p=gl_PointCoord*2.0-1.0; float r2=dot(p,p); if(r2>1.0) discard;
  float gaussian=exp(-r2*4.5); float core=exp(-r2*15.0);
  float depthGlow=0.72+v_depth*0.55;
  vec3 rgb=v_color.rgb*(0.72+core*0.55)*depthGlow;
  float alpha=v_color.a*gaussian;
  outColor=vec4(rgb,alpha);
}`;
const BACKGROUND_VERTEX = `#version 300 es
in vec2 a_quad_position; out vec2 v_tex_coord;
void main(){ v_tex_coord=vec2(0.5-a_quad_position.x*0.5, 0.5+a_quad_position.y*0.5); gl_Position=vec4(a_quad_position,0.0,1.0); }`;
const BACKGROUND_FRAGMENT = `#version 300 es
precision mediump float; uniform sampler2D u_video_texture; in vec2 v_tex_coord; out vec4 outColor;
void main(){ vec4 v=texture(u_video_texture,v_tex_coord); outColor=vec4(v.rgb*0.22,1.0); }`;
const FULLSCREEN_VERTEX = `#version 300 es
out vec2 v_uv;
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); v_uv=p; gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`;
const FADE_FRAGMENT = `#version 300 es
precision highp float; uniform float u_fade; out vec4 outColor;
void main(){ outColor=vec4(0.0,0.0,0.0,u_fade); }`;
const BRIGHT_FRAGMENT = `#version 300 es
precision highp float; uniform sampler2D u_source; uniform float u_threshold; in vec2 v_uv; out vec4 outColor;
void main(){ vec3 c=texture(u_source,v_uv).rgb; float b=max(max(c.r,c.g),c.b); float w=max(0.0,b-u_threshold)/max(b,0.0001); outColor=vec4(c*w,1.0); }`;
const DOWNSAMPLE_FRAGMENT = `#version 300 es
precision highp float; uniform sampler2D u_source; in vec2 v_uv; out vec4 outColor;
void main(){ vec2 t=1.0/vec2(textureSize(u_source,0)); vec3 c=texture(u_source,v_uv+vec2(-t.x,-t.y)).rgb+texture(u_source,v_uv+vec2(t.x,-t.y)).rgb+texture(u_source,v_uv+vec2(-t.x,t.y)).rgb+texture(u_source,v_uv+t).rgb; outColor=vec4(c*0.25,1.0); }`;
const BLUR_FRAGMENT = `#version 300 es
precision highp float; uniform sampler2D u_source; uniform vec2 u_direction; in vec2 v_uv; out vec4 outColor;
void main(){ vec3 c=texture(u_source,v_uv).rgb*0.227027; c+=texture(u_source,v_uv+u_direction*1.384615).rgb*0.316216; c+=texture(u_source,v_uv-u_direction*1.384615).rgb*0.316216; c+=texture(u_source,v_uv+u_direction*3.230769).rgb*0.070270; c+=texture(u_source,v_uv-u_direction*3.230769).rgb*0.070270; outColor=vec4(c,1.0); }`;
const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float; uniform sampler2D u_source; uniform float u_strength; in vec2 v_uv; out vec4 outColor;
void main(){ outColor=vec4(texture(u_source,v_uv).rgb*u_strength,1.0); }`;

interface RenderTarget { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number; }

export class WebGLRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private disposed = false;
  private particleProgram: WebGLProgram;
  private backgroundProgram: WebGLProgram;
  private fadeProgram: WebGLProgram;
  private brightProgram: WebGLProgram;
  private downsampleProgram: WebGLProgram;
  private blurProgram: WebGLProgram;
  private compositeProgram: WebGLProgram;
  private positionBuffer: WebGLBuffer;
  private colorBuffer: WebGLBuffer;
  private sizeBuffer: WebGLBuffer;
  private depthBuffer: WebGLBuffer;
  private particleVao: WebGLVertexArrayObject;
  private quadBuffer: WebGLBuffer;
  private backgroundVao: WebGLVertexArrayObject;
  private fullscreenVao: WebGLVertexArrayObject;
  private videoTexture: WebGLTexture;
  private targets: Record<string, RenderTarget> = {};
  private width = 0;
  private height = 0;
  private readonly maxParticles: number;
  private readonly hasFloatTargets: boolean;
  private trailsEnabled = true;
  private bloomEnabled = true;

  constructor(canvas: HTMLCanvasElement, maxParticles = Config.PARTICLE_MAX) {
    this.canvas = canvas;
    this.maxParticles = maxParticles;
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("WebGL2 is not supported by this browser or graphics device.");
    this.gl = gl;
    this.hasFloatTargets = Boolean(gl.getExtension("EXT_color_buffer_float"));
    this.particleProgram = this.createProgram(PARTICLE_VERTEX, PARTICLE_FRAGMENT);
    this.backgroundProgram = this.createProgram(BACKGROUND_VERTEX, BACKGROUND_FRAGMENT);
    this.fadeProgram = this.createProgram(FULLSCREEN_VERTEX, FADE_FRAGMENT);
    this.brightProgram = this.createProgram(FULLSCREEN_VERTEX, BRIGHT_FRAGMENT);
    this.downsampleProgram = this.createProgram(FULLSCREEN_VERTEX, DOWNSAMPLE_FRAGMENT);
    this.blurProgram = this.createProgram(FULLSCREEN_VERTEX, BLUR_FRAGMENT);
    this.compositeProgram = this.createProgram(FULLSCREEN_VERTEX, COMPOSITE_FRAGMENT);
    const posLoc = gl.getAttribLocation(this.particleProgram, "a_position");
    const colorLoc = gl.getAttribLocation(this.particleProgram, "a_color");
    const sizeLoc = gl.getAttribLocation(this.particleProgram, "a_size");
    const depthLoc = gl.getAttribLocation(this.particleProgram, "a_depth");
    this.positionBuffer = this.makeBuffer(maxParticles * 2 * 4);
    this.colorBuffer = this.makeBuffer(maxParticles * 4 * 4);
    this.sizeBuffer = this.makeBuffer(maxParticles * 4);
    this.depthBuffer = this.makeBuffer(maxParticles * 4);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("Could not create particle vertex array.");
    this.particleVao = vao;
    gl.bindVertexArray(vao);
    this.bindAttribute(this.positionBuffer, posLoc, 2);
    this.bindAttribute(this.colorBuffer, colorLoc, 4);
    this.bindAttribute(this.sizeBuffer, sizeLoc, 1);
    this.bindAttribute(this.depthBuffer, depthLoc, 1);
    gl.bindVertexArray(null);

    const qBuffer = gl.createBuffer();
    const qVao = gl.createVertexArray();
    if (!qBuffer || !qVao) throw new Error("Could not create video quad buffers.");
    this.quadBuffer = qBuffer; this.backgroundVao = qVao;
    gl.bindVertexArray(qVao); gl.bindBuffer(gl.ARRAY_BUFFER, qBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const bgLoc = gl.getAttribLocation(this.backgroundProgram, "a_quad_position");
    gl.enableVertexAttribArray(bgLoc); gl.vertexAttribPointer(bgLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    const fullVao = gl.createVertexArray();
    if (!fullVao) throw new Error("Could not create full-screen vertex array.");
    this.fullscreenVao = fullVao;
    const tex = gl.createTexture();
    if (!tex) throw new Error("Could not create webcam texture.");
    this.videoTexture = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Unable to allocate a WebGL shader.");
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const detail = gl.getShaderInfoLog(shader) ?? "unknown shader compilation error";
        gl.deleteShader(shader); throw new Error(detail);
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vertexSource);
    const fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) { gl.deleteShader(vs); gl.deleteShader(fs); throw new Error("Unable to allocate a WebGL program."); }
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const detail = gl.getProgramInfoLog(program) ?? "unknown program link error";
      gl.deleteProgram(program); throw new Error(detail);
    }
    return program;
  }

  private makeBuffer(byteLength: number): WebGLBuffer {
    const gl = this.gl; const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Unable to allocate a WebGL buffer.");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, byteLength, gl.DYNAMIC_DRAW);
    return buffer;
  }
  private bindAttribute(buffer: WebGLBuffer, location: number, width: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, width, gl.FLOAT, false, 0, 0);
  }

  private createTarget(width: number, height: number, preferFloat: boolean): RenderTarget {
    const gl = this.gl;
    const texture = gl.createTexture(); const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error("Unable to allocate WebGL post-processing target.");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const useFloat = preferFloat && this.hasFloatTargets;
    gl.texImage2D(gl.TEXTURE_2D, 0, useFloat ? gl.RGBA16F : gl.RGBA8, width, height, 0, gl.RGBA, useFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE && useFloat) {
      gl.deleteTexture(texture); gl.deleteFramebuffer(framebuffer);
      return this.createTarget(width, height, false);
    }
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(texture); gl.deleteFramebuffer(framebuffer);
      throw new Error(`WebGL post-processing framebuffer incomplete: ${status}`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, framebuffer, width, height };
  }

  private destroyTargets(): void {
    for (const target of Object.values(this.targets)) {
      this.gl.deleteTexture(target.texture); this.gl.deleteFramebuffer(target.framebuffer);
    }
    this.targets = {};
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.width === width && this.height === height) return;
    this.width = width; this.height = height;
    this.canvas.width = width; this.canvas.height = height;
    const gl = this.gl; gl.viewport(0, 0, width, height);
    this.destroyTargets();
    const halfW = Math.max(1, Math.floor(width / 2)), halfH = Math.max(1, Math.floor(height / 2));
    const quarterW = Math.max(1, Math.floor(width / 4)), quarterH = Math.max(1, Math.floor(height / 4));
    this.targets.trail = this.createTarget(width, height, true);
    this.targets.brightHalf = this.createTarget(halfW, halfH, true);
    this.targets.blurHalfA = this.createTarget(halfW, halfH, true);
    this.targets.blurHalfB = this.createTarget(halfW, halfH, true);
    this.targets.brightQuarter = this.createTarget(quarterW, quarterH, true);
    this.targets.blurQuarterA = this.createTarget(quarterW, quarterH, true);
    this.targets.blurQuarterB = this.createTarget(quarterW, quarterH, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.trail.framebuffer);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  public setEffectsEnabled(bloom: boolean, trails: boolean): void {
    this.bloomEnabled = bloom; this.trailsEnabled = trails;
  }

  private drawFullscreen(program: WebGLProgram): void {
    const gl = this.gl; gl.useProgram(program); gl.bindVertexArray(this.fullscreenVao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
  }
  private setSource(program: WebGLProgram, texture: WebGLTexture): void {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    const loc = gl.getUniformLocation(program, "u_source"); if (loc) gl.uniform1i(loc, 0);
  }
  private postProcess(source: RenderTarget, destination: RenderTarget, program: WebGLProgram, configure?: () => void): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, destination.framebuffer); gl.viewport(0, 0, destination.width, destination.height);
    gl.disable(gl.BLEND); this.setSource(program, source.texture); configure?.(); this.drawFullscreen(program);
  }

  public render(
    positions: Float32Array,
    colors: Float32Array,
    sizes: Float32Array,
    depths: Float32Array,
    count: number,
    videoElement: HTMLVideoElement | null = null,
    qualityLevel = 0,
  ): void {
    if (this.disposed) return;
    const gl = this.gl; this.resize();
    // 1. Draw webcam to the default framebuffer first. Trail FBO is particles-only, so video never smears.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.BLEND); gl.clearColor(0.006, 0.006, 0.012, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    if (videoElement && videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoElement); } catch { /* tolerate a camera frame race */ }
      gl.useProgram(this.backgroundProgram); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
      const loc = gl.getUniformLocation(this.backgroundProgram, "u_video_texture"); if (loc) gl.uniform1i(loc, 0);
      gl.bindVertexArray(this.backgroundVao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    }

    // 2. Fade previous particle texture and render current particles into the persistent offscreen target.
    const trail = this.targets.trail;
    gl.bindFramebuffer(gl.FRAMEBUFFER, trail.framebuffer); gl.viewport(0, 0, this.width, this.height);
    if (this.trailsEnabled && qualityLevel < 3) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.fadeProgram); const fadeLoc = gl.getUniformLocation(this.fadeProgram, "u_fade");
      if (fadeLoc) gl.uniform1f(fadeLoc, Config.TRAIL_FADE); this.drawFullscreen(this.fadeProgram);
    } else { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    const n = Math.max(0, Math.min(count, this.maxParticles));
    // Typed-array subarrays are views, not copies; no GPU store reallocations happen after construction.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions, 0, n * 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, colors, 0, n * 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, sizes, 0, n);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.depthBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, depths, 0, n);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.particleProgram); gl.bindVertexArray(this.particleVao); gl.drawArrays(gl.POINTS, 0, n); gl.bindVertexArray(null);

    // 3. Bloom bright pass, half/quarter downsample, separable Gaussian blur.
    const bloomActive = this.bloomEnabled && qualityLevel < 3;
    if (bloomActive) {
      this.postProcess(trail, this.targets.brightHalf, this.brightProgram, () => {
        const t = gl.getUniformLocation(this.brightProgram, "u_threshold"); if (t) gl.uniform1f(t, Config.BLOOM_THRESHOLD);
      });
      this.postProcess(this.targets.brightHalf, this.targets.blurHalfA, this.blurProgram, () => {
        const d = gl.getUniformLocation(this.blurProgram, "u_direction"); if (d) gl.uniform2f(d, 1 / this.targets.blurHalfA.width, 0);
      });
      this.postProcess(this.targets.blurHalfA, this.targets.blurHalfB, this.blurProgram, () => {
        const d = gl.getUniformLocation(this.blurProgram, "u_direction"); if (d) gl.uniform2f(d, 0, 1 / this.targets.blurHalfB.height);
      });
      this.postProcess(this.targets.brightHalf, this.targets.brightQuarter, this.downsampleProgram);
      this.postProcess(this.targets.brightQuarter, this.targets.blurQuarterA, this.blurProgram, () => {
        const d = gl.getUniformLocation(this.blurProgram, "u_direction"); if (d) gl.uniform2f(d, 1 / this.targets.blurQuarterA.width, 0);
      });
      this.postProcess(this.targets.blurQuarterA, this.targets.blurQuarterB, this.blurProgram, () => {
        const d = gl.getUniformLocation(this.blurProgram, "u_direction"); if (d) gl.uniform2f(d, 0, 1 / this.targets.blurQuarterB.height);
      });
    }

    // 4. Composite particle trails and bloom additively over the clean webcam background.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.width, this.height);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    this.setSource(this.compositeProgram, trail.texture);
    const strength = gl.getUniformLocation(this.compositeProgram, "u_strength"); if (strength) gl.uniform1f(strength, 1.0);
    this.drawFullscreen(this.compositeProgram);
    if (bloomActive) {
      this.setSource(this.compositeProgram, this.targets.blurHalfB.texture);
      const halfStrength = gl.getUniformLocation(this.compositeProgram, "u_strength"); if (halfStrength) gl.uniform1f(halfStrength, Config.BLOOM_STRENGTH * 0.35);
      this.drawFullscreen(this.compositeProgram);
      this.setSource(this.compositeProgram, this.targets.blurQuarterB.texture);
      const quarterStrength = gl.getUniformLocation(this.compositeProgram, "u_strength"); if (quarterStrength) gl.uniform1f(quarterStrength, Config.BLOOM_STRENGTH * 0.7);
      this.drawFullscreen(this.compositeProgram);
    }
    gl.disable(gl.BLEND); gl.bindVertexArray(null); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(null);
  }

  /** Delete allocations; loseContext is reserved for final unmount so stop/start can reuse the canvas. */
  public destroy(loseContext = false, restoreForRestart = false): boolean {
    if (this.disposed) return false;
    this.disposed = true;
    const gl = this.gl;
    this.destroyTargets();
    gl.deleteBuffer(this.positionBuffer); gl.deleteBuffer(this.colorBuffer); gl.deleteBuffer(this.sizeBuffer); gl.deleteBuffer(this.depthBuffer);
    gl.deleteVertexArray(this.particleVao); gl.deleteVertexArray(this.backgroundVao); gl.deleteVertexArray(this.fullscreenVao);
    gl.deleteBuffer(this.quadBuffer); gl.deleteTexture(this.videoTexture);
    gl.deleteProgram(this.particleProgram); gl.deleteProgram(this.backgroundProgram); gl.deleteProgram(this.fadeProgram);
    gl.deleteProgram(this.brightProgram); gl.deleteProgram(this.downsampleProgram); gl.deleteProgram(this.blurProgram); gl.deleteProgram(this.compositeProgram);
    if (loseContext) {
      const extension = gl.getExtension("WEBGL_lose_context");
      if (extension) {
        if (restoreForRestart) {
          // The component prevents the loss event's default action, then restore after the
          // simulated loss event has been delivered so the same canvas can be started again.
          const restoreAfterLoss = () => {
            window.setTimeout(() => {
              try { extension.restoreContext(); } catch (error) { console.warn("WebGL context restoration failed:", error); }
            }, 100);
          };
          this.canvas.addEventListener("webglcontextlost", restoreAfterLoss, { once: true });
        }
        extension.loseContext();
        return true;
      }
    }
    return false;
  }
}
export default WebGLRenderer;
