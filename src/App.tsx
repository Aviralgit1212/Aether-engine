/** @license SPDX-License-Identifier: Apache-2.0 */
import { useCallback, useEffect, useState } from "react";
import { AetherEngine } from "./components/AetherEngine";
import { DebugOverlay } from "./components/DebugOverlay";
import { InstructionCard } from "./components/InstructionCard";
import { EngineLoop, EngineStats } from "./core/EngineLoop";
import { Config } from "./core/Config";
import { Cpu, Eye, EyeOff, Activity, Sparkles } from "lucide-react";

function loadSignature(): string {
  try {
    return (window.localStorage.getItem("aether-signature-text") ?? Config.SIGNATURE_TEXT)
      .toUpperCase().replace(/[^A-Z0-9 ._-]/g, "").slice(0, 12).trim() || "AVIRAL";
  } catch { return Config.SIGNATURE_TEXT; }
}

export default function App() {
  const [engineActive, setEngineActive] = useState(false);
  const [debugHudVisible, setDebugHudVisible] = useState(true);
  const [engineController, setEngineController] = useState<EngineLoop | null>(null);
  const [signatureText, setSignatureText] = useState(loadSignature);
  const [liveStats, setLiveStats] = useState<EngineStats>({
    fps: 0, energyLevel: 0, gripValue: 0, stability: null, state: "IDLE", stateProgress: 0,
    handDetected: false, handInGracePeriod: false, inferenceMs: 0, physicsMs: 0, renderMs: 0,
    frameMsP95: 0, activeCount: Config.PARTICLE_COUNT, qualityLevel: 0,
    qualityReason: "Configured start level", averageFps1s: 0, pinchValue: 0, openPalmValue: 0,
    benchmarkRunning: false, benchmarkResults: [], bloomEnabled: true, trailsEnabled: true,
    signatureText: Config.SIGNATURE_TEXT,
  });

  const handleStatsUpdate = useCallback((stats: EngineStats) => setLiveStats(stats), []);
  const handleEngineChange = useCallback((engine: EngineLoop | null) => setEngineController(engine), []);

  useEffect(() => {
    Config.SIGNATURE_TEXT = signatureText;
    engineController?.setSignatureText(signatureText);
    try { window.localStorage.setItem("aether-signature-text", signatureText); } catch { /* storage may be disabled; in-memory setting still works */ }
  }, [signatureText, engineController]);

  const updateSignature = (raw: string) => {
    const value = raw.toUpperCase().replace(/[^A-Z0-9 ._-]/g, "").slice(0, 12);
    setSignatureText(value || "AVIRAL");
  };

 return (
    <div className="min-h-screen bg-[#050505] text-[#E0D8D0] font-sans flex flex-col selection:bg-gold/30 selection:text-gold-bright">
      <header className="sticky top-0 z-50 h-16 border-b border-gold/20 bg-black/40 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
          <div className="flex items-center space-x-4"><div className={`w-3 h-3 bg-gold rounded-full ${engineActive ? "animate-pulse" : "opacity-40"}`} /><div><h1 className="font-serif text-lg tracking-widest text-gold uppercase flex items-center gap-2">Aether Engine <span className="font-sans text-[9px] opacity-60 uppercase tracking-widest font-mono">V2</span></h1></div></div>
          <div className="flex items-center space-x-6 md:space-x-10">
            <div className="hidden sm:flex flex-col items-end"><span className="text-[9px] uppercase tracking-widest opacity-50 font-mono">Inference latency · EMA</span><span className="font-mono text-xs text-gold">{engineActive && liveStats.inferenceMs > 0 ? `${liveStats.inferenceMs.toFixed(1)} ms` : "—"}</span></div>
            <div className="flex flex-col items-end"><span className="text-[9px] uppercase tracking-widest opacity-50 font-mono">Measured frame rate</span><span className="font-mono text-xs text-gold">{engineActive && liveStats.fps > 0 ? `${liveStats.fps.toFixed(1)} FPS` : "—"}</span></div>
            <button type="button" onClick={() => setDebugHudVisible((value) => !value)} className={`p-2 rounded-md border transition ${debugHudVisible ? "border-gold/30 bg-gold/10 text-gold" : "border-neutral-800 bg-neutral-950 text-neutral-400"}`} title={debugHudVisible ? "Hide diagnostics" : "Show diagnostics"}>{debugHudVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}</button>
          </div>
        </div>
      </header>

      <main className="flex-grow max-w-7xl w-full mx-auto px-6 py-8 md:py-12 flex flex-col gap-8">
        <div className="flex flex-col gap-3 max-w-4xl">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gold/5 border border-gold/20 w-fit"><Cpu className="w-3.5 h-3.5 text-gold" /><span className="text-[9px] font-mono tracking-widest uppercase font-semibold text-gold">Interactive CPU Physics · WebGL2 Renderer</span></div>
          <h2 className="font-serif italic text-3xl md:text-5xl tracking-wide text-gold">Sculpt Living Energy with Your Hands</h2>
          <p className="text-sm md:text-base text-neutral-400 leading-relaxed mt-1">A hand-controlled particle field with adaptive quality, real inference/frame timings, bloom, trails, depth, and an interactive signature reveal.</p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-2 rounded-lg border border-gold/10 bg-black/50 p-4 max-w-xl">
            <label htmlFor="signature-text" className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">Signature text</label>
            <input id="signature-text" value={signatureText} maxLength={12} onChange={(event) => updateSignature(event.target.value)} className="w-full sm:w-64 bg-neutral-950 border border-white/10 rounded px-3 py-2 text-sm tracking-[0.18em] text-gold uppercase outline-none focus:border-gold/50" placeholder="AVIRAL" />
            <span className="text-[9px] text-neutral-600 font-mono">12 chars max · saved locally</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <AetherEngine onStatsUpdate={handleStatsUpdate} onActiveChange={setEngineActive} onEngineChange={handleEngineChange} signatureText={signatureText} />
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 rounded-lg bg-black/60 border border-gold/10 text-xs text-neutral-500">
              <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-gold/80"><Activity className="w-3.5 h-3.5 text-gold" />DYNAMICS: SEMI-IMPLICIT EULER</div>
              <div className="flex flex-wrap items-center gap-4 font-mono text-[10px] uppercase"><span>PARTICLES: <strong className="text-[#E0D8D0]">{liveStats.activeCount.toLocaleString()}</strong></span><span>BUFFER MODE: <strong className="text-[#E0D8D0]">CPU PHYSICS · WEBGL2 RENDER</strong></span></div>
            </div>
          </div>
          <div className="flex flex-col gap-6 lg:col-span-1">
            <DebugOverlay stats={liveStats} visible={debugHudVisible} engineRunning={engineActive}
              onReplaySignature={() => engineController?.replaySignature()}
              onStartBenchmark={() => engineController?.startBenchmark()}
              onToggleBloom={() => engineController?.toggleBloom()}
              onToggleTrails={() => engineController?.toggleTrails()} />
            <InstructionCard signatureText={signatureText} />
          </div>
        </div>
      </main>

      <footer className="h-14 border-t border-white/5 px-8 flex items-center justify-between bg-black/80 text-[9px] uppercase tracking-[0.2em] text-neutral-500"><div className="flex items-center gap-2"><Sparkles className="w-3.5 h-3.5 text-gold/40" /><span>Aether Engine V2 · Local interactive prototype</span></div><div className="flex items-center gap-6 font-mono text-[10px]"><span className="hidden sm:inline">No backend required</span><span>{engineActive ? "Engine active" : "Camera inactive"}</span></div></footer>
    </div>
  );
}
