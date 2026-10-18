/** @license SPDX-License-Identifier: Apache-2.0 */
import React from "react";
import { EngineStats } from "../core/EngineLoop";
import { Config, QUALITY_LEVELS } from "../core/Config";
import { Activity, Zap, Sparkles, Camera, Gauge, Play, RotateCcw, Flame, Waves } from "lucide-react";

interface DebugOverlayProps {
  stats: EngineStats;
  visible: boolean;
  engineRunning: boolean;
  onReplaySignature: () => void;
  onStartBenchmark: () => void;
  onToggleBloom: () => void;
  onToggleTrails: () => void;
}

const metric = (value: number, digits = 1) => Number.isFinite(value) && value > 0 ? value.toFixed(digits) : "—";

export const DebugOverlay: React.FC<DebugOverlayProps> = ({
  stats, visible, engineRunning, onReplaySignature, onStartBenchmark, onToggleBloom, onToggleTrails,
}) => {
  if (!visible) return null;
  const hasHand = stats.handDetected;
  const isStable = stats.stability !== null && stats.stability <= Config.STABILITY_EPSILON;
  const stateClass = stats.state === "READY" || stats.state === "FORMING_TEXT" || stats.state === "TEXT_HOLD"
    ? "text-gold border-gold/30 bg-gold/10"
    : stats.state === "VIBRATING" || stats.state === "COMPRESSING" ? "text-red-300 border-red-500/30 bg-red-500/10"
      : "text-neutral-200 border-white/10 bg-black/40";

  return (
    <div id="hud-telemetry-panel" className="w-full bg-black/60 backdrop-blur-md rounded-xl border border-gold/15 p-5 flex flex-col gap-5 font-sans shadow-2xl">
      <div className="flex items-center justify-between border-b border-white/5 pb-3">
        <div className="flex items-center gap-2"><Activity className="w-4 h-4 text-gold" /><h4 className="text-xs font-serif tracking-widest uppercase text-gold">V2 Live Diagnostics</h4></div>
        <span className="text-[9px] font-mono text-neutral-500">MEASURED</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Metric icon={<Gauge className="w-4 h-4" />} label="FPS" value={stats.fps > 0 ? stats.fps.toFixed(1) : "—"} />
        <Metric icon={<Camera className="w-4 h-4" />} label="Inference EMA" value={`${metric(stats.inferenceMs)} ms`} />
        <Metric icon={<Activity className="w-4 h-4" />} label="Physics / frame" value={`${metric(stats.physicsMs, 2)} ms`} />
        <Metric icon={<Activity className="w-4 h-4" />} label="Render submit" value={`${metric(stats.renderMs, 2)} ms`} />
        <Metric icon={<Gauge className="w-4 h-4" />} label="Frame p95" value={`${metric(stats.frameMsP95, 2)} ms`} />
        <Metric icon={<Sparkles className="w-4 h-4" />} label="Active particles" value={stats.activeCount.toLocaleString()} />
      </div>

      <div className={`rounded-lg border p-3 ${stateClass}`}>
        <div className="flex items-center justify-between"><span className="font-mono text-sm font-bold tracking-wider">{stats.state}</span><span className="text-[9px] uppercase tracking-widest">{stats.stateProgress > 0 ? `${Math.round(stats.stateProgress * 100)}%` : "LIVE"}</span></div>
        <div className="mt-2 h-1.5 bg-black/60 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-amber-300" style={{ width: `${Math.max(0, Math.min(100, stats.stateProgress * 100))}%` }} /></div>
      </div>

      <div className="flex flex-col gap-3">
        <Meter label="Energy estimate" value={stats.energyLevel} suffix="%" icon={<Zap className="w-3.5 h-3.5" />} />
        <Meter label="Fist grip" value={stats.gripValue * 100} suffix="%" icon={<Sparkles className="w-3.5 h-3.5" />} />
        <Meter label="Pinch" value={stats.pinchValue * 100} suffix="%" icon={<Sparkles className="w-3.5 h-3.5" />} />
        <Meter label="Open palm" value={stats.openPalmValue * 100} suffix="%" icon={<Sparkles className="w-3.5 h-3.5" />} />
      </div>

      <div className="grid grid-cols-2 gap-3 text-[10px] font-mono text-neutral-400">
        <div className="rounded border border-white/5 p-2"><div className="text-neutral-600 mb-1">HAND</div><div className={hasHand ? "text-emerald-300" : "text-neutral-500"}>{stats.handInGracePeriod ? "GRACE PERIOD" : hasHand ? "DETECTED" : "NOT DETECTED"}</div></div>
        <div className="rounded border border-white/5 p-2"><div className="text-neutral-600 mb-1">STABILITY</div><div className={isStable ? "text-gold" : "text-neutral-300"}>{stats.stability === null ? "N/A" : `${stats.stability.toFixed(4)}${isStable ? " · STABLE" : ""}`}</div></div>
      </div>

      <div className="rounded-lg border border-white/5 p-3 flex flex-col gap-1">
        <div className="flex justify-between text-[10px] font-mono uppercase text-neutral-500"><span>Adaptive quality</span><span>{stats.benchmarkRunning ? "Benchmark" : `Level ${stats.qualityLevel + 1}/4`}</span></div>
        <div className="font-mono text-xs text-neutral-200">{stats.activeCount.toLocaleString()} particles · {stats.benchmarkRunning ? "benchmark in progress" : stats.averageFps1s > 0 ? `${stats.averageFps1s.toFixed(1)} FPS avg` : "measuring FPS…"}</div>
        <p className="text-[10px] leading-relaxed text-neutral-500">{stats.qualityReason}</p>
        <p className="text-[9px] text-neutral-600">Quality ladder: {QUALITY_LEVELS.map((n) => n.toLocaleString()).join(" / ")}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ActionButton onClick={onToggleBloom} disabled={!engineRunning} active={stats.bloomEnabled} icon={<Flame className="w-3.5 h-3.5" />} label={`Bloom ${stats.bloomEnabled ? "ON" : "OFF"}`} />
        <ActionButton onClick={onToggleTrails} disabled={!engineRunning} active={stats.trailsEnabled} icon={<Waves className="w-3.5 h-3.5" />} label={`Trails ${stats.trailsEnabled ? "ON" : "OFF"}`} />
        <ActionButton onClick={onReplaySignature} disabled={!engineRunning} active={false} icon={<RotateCcw className="w-3.5 h-3.5" />} label="Replay signature" />
        <ActionButton onClick={onStartBenchmark} active={stats.benchmarkRunning} icon={<Play className="w-3.5 h-3.5" />} disabled={!engineRunning || stats.benchmarkRunning} label={stats.benchmarkRunning ? "Benchmarking…" : "Run benchmark"} />
      </div>

      {stats.benchmarkResults.length > 0 && <div className="overflow-x-auto rounded-lg border border-gold/10 p-3">
        <div className="text-[10px] font-mono tracking-widest uppercase text-gold mb-2">Benchmark results (5 sec per count)</div>
        <table className="w-full text-[10px] font-mono text-neutral-400"><thead><tr className="text-neutral-600"><th className="text-left py-1">Particles</th><th className="text-right">FPS</th><th className="text-right">p95 ms</th><th className="text-right">Physics</th><th className="text-right">Render</th></tr></thead><tbody>{stats.benchmarkResults.map((row) => <tr key={row.particles} className="border-t border-white/5"><td className="py-1">{row.particles.toLocaleString()}</td><td className="text-right">{row.avgFps.toFixed(1)}</td><td className="text-right">{row.frameMsP95.toFixed(1)}</td><td className="text-right">{row.physicsMs.toFixed(2)}</td><td className="text-right">{row.renderMs.toFixed(2)}</td></tr>)}</tbody></table>
      </div>}
      <p className="text-[9px] text-neutral-600 leading-relaxed">Physics: CPU · Drawing: WebGL2 · Camera inference runs locally in this browser.</p>
    </div>
  );
};

const Metric: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="border border-white/5 bg-black/40 p-3 rounded-lg"><div className="flex items-center gap-1.5 text-neutral-500 mb-1">{icon}<span className="text-[9px] uppercase font-mono tracking-wider">{label}</span></div><div className="font-mono text-sm text-neutral-100">{value}</div></div>
);
const Meter: React.FC<{ label: string; value: number; suffix: string; icon: React.ReactNode }> = ({ label, value, suffix, icon }) => {
  const safeValue = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return <div><div className="flex items-center justify-between text-[10px] font-mono text-neutral-400 mb-1"><span className="flex items-center gap-1.5">{icon}{label}</span><span>{safeValue.toFixed(1)}{suffix}</span></div><div className="h-1.5 rounded-full bg-neutral-900 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-blue-500 via-purple-500 to-amber-300" style={{ width: `${safeValue}%` }} /></div></div>;
};
const ActionButton: React.FC<{ onClick: () => void; active: boolean; icon: React.ReactNode; label: string; disabled?: boolean }> = ({ onClick, active, icon, label, disabled = false }) => (
  <button type="button" onClick={onClick} disabled={disabled} className={`flex items-center justify-center gap-1.5 rounded border px-2 py-2 text-[9px] font-mono uppercase tracking-wide transition disabled:opacity-50 disabled:cursor-not-allowed ${active ? "border-gold/30 bg-gold/10 text-gold" : "border-white/10 bg-black/40 text-neutral-400 hover:border-gold/25 hover:text-neutral-100"}`}>{icon}{label}</button>
);
export default DebugOverlay;
