/** @license SPDX-License-Identifier: Apache-2.0 */
import React, { useEffect, useRef, useState } from "react";
import { EngineLoop } from "../core/EngineLoop";
import { Play, RotateCcw, AlertCircle, Camera, ShieldAlert } from "lucide-react";

interface AetherEngineProps {
  onStatsUpdate: (stats: import("../core/EngineLoop").EngineStats) => void;
  onActiveChange: (active: boolean) => void;
  onEngineChange: (engine: EngineLoop | null) => void;
  signatureText: string;
}

type LoadingState = "idle" | "loading" | "running" | "error";

export const AetherEngine: React.FC<AetherEngineProps> = ({ onStatsUpdate, onActiveChange, onEngineChange, signatureText }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<EngineLoop | null>(null);
  const startingRef = useRef(false);
  const mountedRef = useRef(false);
  const contextRestorationPendingRef = useRef(false);
  const onEngineChangeRef = useRef(onEngineChange);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  onEngineChangeRef.current = onEngineChange;

  useEffect(() => {
    mountedRef.current = true;
    const canvas = canvasRef.current;
    const onContextLost = (event: Event) => { event.preventDefault(); };
    const onContextRestored = () => { contextRestorationPendingRef.current = false; };
    canvas?.addEventListener("webglcontextlost", onContextLost);
    canvas?.addEventListener("webglcontextrestored", onContextRestored);
    return () => {
      mountedRef.current = false;
      const engine = engineRef.current;
      engineRef.current = null;
      if (engine) engine.stop(true);
      canvas?.removeEventListener("webglcontextlost", onContextLost);
      canvas?.removeEventListener("webglcontextrestored", onContextRestored);
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setSignatureText(signatureText);
  }, [signatureText]);

  const waitForContextRestore = async (canvas: HTMLCanvasElement): Promise<void> => {
    if (!contextRestorationPendingRef.current) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        canvas.removeEventListener("webglcontextrestored", onRestored);
        contextRestorationPendingRef.current = false;
        reject(new Error("WebGL context did not restore in time. Refresh the page and try again."));
      }, 6000);
      const onRestored = () => {
        window.clearTimeout(timeout);
        contextRestorationPendingRef.current = false;
        resolve();
      };
      canvas.addEventListener("webglcontextrestored", onRestored, { once: true });
    });
  };

  const startEngine = async () => {
    if (startingRef.current || engineRef.current || !canvasRef.current) return;
    startingRef.current = true;
    setLoadingState("loading");
    setErrorMsg(null);
    let engine: EngineLoop | null = null;
    try {
      await waitForContextRestore(canvasRef.current);
      if (!mountedRef.current || !canvasRef.current) return;
      engine = new EngineLoop(canvasRef.current);
      engine.setSignatureText(signatureText);
      engine.registerOnStatsUpdate(onStatsUpdate);
      engineRef.current = engine;
      onEngineChangeRef.current(engine);
      await engine.start((message) => {
        if (!mountedRef.current) return;
        setErrorMsg(message);
      });
      if (!mountedRef.current || engineRef.current !== engine) {
        engine.stop();
        return;
      }
      setLoadingState("running");
      onActiveChange(true);
    } catch (error) {
      if (engine) {
        const gl = canvasRef.current?.getContext("webgl2");
        contextRestorationPendingRef.current = Boolean(gl?.getExtension("WEBGL_lose_context"));
        const canRestore = engine.stop();
        if (!canRestore) contextRestorationPendingRef.current = false;
      }
      if (engineRef.current === engine) engineRef.current = null;
      onEngineChangeRef.current(null);
      if (mountedRef.current) {
        setErrorMsg(error instanceof Error ? error.message : String(error));
        setLoadingState("error");
        onActiveChange(false);
      }
    } finally {
      startingRef.current = false;
    }
  };

  const stopEngine = () => {
    const engine = engineRef.current;
    engineRef.current = null;
    if (engine) {
      const gl = canvasRef.current?.getContext("webgl2");
      contextRestorationPendingRef.current = Boolean(gl?.getExtension("WEBGL_lose_context"));
      const canRestore = engine.stop();
      if (!canRestore) contextRestorationPendingRef.current = false;
    }
    onEngineChangeRef.current(null);
    setLoadingState("idle");
    setErrorMsg(null);
    onActiveChange(false);
  };

  const resetParticles = () => engineRef.current?.resetParticles();

  return (
    <div id="aether-engine-container" className="relative w-full h-[65vh] md:h-[75vh] rounded-xl overflow-hidden border border-gold/20 bg-[#050505] shadow-2xl">
      <div className="absolute inset-0 pointer-events-none opacity-[0.06] z-0" style={{ backgroundImage: "radial-gradient(#D4AF37 0.8px, transparent 0.8px)", backgroundSize: "24px 24px" }} />
      <canvas id="aether-webgl-canvas" ref={canvasRef} className="w-full h-full block cursor-crosshair relative z-10" />
      <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-gold/20 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(5,5,5,0.9)_100%)] z-20" />

      {loadingState === "idle" && <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-black/90 text-center z-30">
        <div className="w-16 h-16 rounded-full border border-gold/30 flex items-center justify-center bg-gold/5 mb-6 animate-pulse"><Camera className="w-7 h-7 text-gold" /></div>
        <h3 className="font-serif text-xl tracking-wider text-gold mb-2">Camera Connection Required</h3>
        <p className="max-w-md text-neutral-400 text-xs md:text-sm mb-8 leading-relaxed px-4">Hand tracking runs locally in your browser. Camera frames are used for the live interaction and are not uploaded by this application.</p>
        <button id="btn-activate-engine" type="button" onClick={startEngine} className="px-8 py-3 bg-gold hover:bg-gold-bright text-black font-semibold text-xs tracking-widest uppercase rounded shadow-lg transition cursor-pointer"><Play className="inline w-3.5 h-3.5 mr-2" />Engage Camera & Launch</button>
        <p className="text-neutral-600 text-[10px] mt-4">Use localhost or HTTPS and allow camera access when prompted.</p>
      </div>}

      {loadingState === "loading" && <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-black/95 text-center z-30">
        <div className="relative w-20 h-20 mb-8"><div className="absolute inset-0 rounded-full border-2 border-gold/10" /><div className="absolute inset-0 rounded-full border-2 border-t-gold border-r-transparent border-b-transparent border-l-transparent animate-spin" /><div className="absolute inset-6 rounded-full bg-gold/20 animate-pulse" /></div>
        <h3 className="font-serif text-lg tracking-wider text-gold uppercase mb-2 animate-pulse">Starting Aether Engine V2</h3>
        <p className="max-w-sm text-neutral-500 text-xs tracking-wider">Requesting camera, loading the hand model and preparing WebGL post-processing…</p>
      </div>}

      {loadingState === "error" && <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-black/95 text-center z-30 border border-red-500/20">
        <div className="w-16 h-16 rounded-full border border-red-500/30 flex items-center justify-center bg-red-500/5 mb-6"><ShieldAlert className="w-8 h-8 text-red-400" /></div>
        <h3 className="font-serif text-lg tracking-wider text-red-300 mb-2">Engine Could Not Start</h3>
        <p role="alert" className="max-w-md text-neutral-300 text-sm mb-6 leading-relaxed px-4">{errorMsg || "The camera or hand tracking system could not be initialized."}</p>
        <div className="flex flex-col sm:flex-row gap-3"><button id="btn-retry-engine" type="button" onClick={startEngine} className="px-5 py-2.5 border border-red-500/30 hover:border-red-500/60 text-red-300 rounded transition">Retry</button><button type="button" onClick={() => { setErrorMsg(null); setLoadingState("idle"); }} className="px-5 py-2.5 border border-white/10 bg-neutral-900 text-neutral-300 rounded transition">Go back</button></div>
      </div>}

      {loadingState === "running" && <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between pointer-events-none z-30">
        <div className="px-3.5 py-2 rounded-full border border-gold/30 bg-black/80 backdrop-blur-md flex items-center gap-2 pointer-events-auto"><div className="w-2 h-2 rounded-full bg-gold animate-pulse" /><span className="text-[9px] tracking-widest font-semibold uppercase text-gold font-mono">ENGINE ACTIVE · V2</span></div>
        <div className="flex gap-2 pointer-events-auto"><button id="btn-reset-particles" type="button" onClick={resetParticles} title="Reset particles" className="p-2.5 rounded border border-white/10 bg-black hover:bg-neutral-900 text-neutral-400 hover:text-gold transition cursor-pointer"><RotateCcw className="w-4 h-4" /></button><button id="btn-stop-engine" type="button" onClick={stopEngine} title="Stop hand tracking and release camera" className="px-3.5 py-2.5 rounded border border-red-500/20 bg-black/80 text-red-300 font-mono text-[9px] tracking-wider uppercase flex items-center gap-1.5 transition cursor-pointer"><AlertCircle className="w-3.5 h-3.5" />Stop</button></div>
      </div>}
    </div>
  );
};
export default AetherEngine;
