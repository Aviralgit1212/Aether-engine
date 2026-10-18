/** @license SPDX-License-Identifier: Apache-2.0 */
import React from "react";
import { Config } from "../core/Config";
import { Hand, Eye, Zap, Sparkles, Sliders, CircleDot, Waves } from "lucide-react";

export const InstructionCard: React.FC<{ signatureText: string }> = ({ signatureText }) => (
  <div id="interaction-guide-panel" className="bg-black/60 border border-gold/15 rounded-xl p-6 flex flex-col gap-5 text-[#E0D8D0]/80 shadow-2xl backdrop-blur-md">
    <div className="flex items-center gap-2.5 border-b border-white/5 pb-4"><Sliders className="w-4 h-4 text-gold" /><h3 className="font-serif text-xs tracking-widest uppercase text-gold">Interaction Mechanics</h3></div>
    <Gesture icon={<Hand className="w-3.5 h-3.5 text-blue-400" />} title="Move your hand" description="Your palm guides the cloud with a spring-damped follow, creating inertia instead of an instant snap." />
    <Gesture icon={<Waves className="w-3.5 h-3.5 text-indigo-300" />} title="Move quickly" description="Fast palm movement emits expanding radial waves through the particle field." />
    <Gesture icon={<CircleDot className="w-3.5 h-3.5 text-violet-300" />} title="Pinch thumb + index" description="Bring the thumb and index finger tips together to attract particles toward their midpoint." />
    <Gesture icon={<Sparkles className="w-3.5 h-3.5 text-cyan-300" />} title="Open palm" description="Extend your fingers to push the cloud outward and increase fluid noise motion." />
    <Gesture icon={<Zap className="w-3.5 h-3.5 text-red-400" />} title="Close your fist" description="The cloud compresses and shifts from blue through purple to crimson. Hold it steadily when energy is ready." />
    <div className="flex gap-3 border-t border-white/5 pt-4"><div className="w-6 h-6 rounded bg-gold/10 border border-gold/30 flex items-center justify-center shrink-0"><Eye className="w-3.5 h-3.5 text-gold" /></div><div><h4 className="font-serif text-xs text-gold uppercase tracking-widest mb-1">Signature sequence</h4><p className="text-xs text-neutral-400 leading-relaxed">Gather the cloud until energy reaches the ready threshold, hold a stable fist for {(Config.FIST_HOLD_DURATION_MS / 1000).toFixed(1)} seconds, and the existing compression → vibration → stillness → formation → hold → dissolve state sequence runs. Current signature: <strong className="text-gold tracking-widest">{signatureText || "AVIRAL"}</strong>.</p></div></div>
  </div>
);
const Gesture: React.FC<{ icon: React.ReactNode; title: string; description: string }> = ({ icon, title, description }) => <div className="flex gap-3"><div className="w-6 h-6 rounded bg-white/5 border border-white/10 flex items-center justify-center shrink-0 mt-0.5">{icon}</div><div><h4 className="font-semibold text-xs text-[#E0D8D0] uppercase tracking-wider mb-1">{title}</h4><p className="text-xs text-neutral-400 leading-relaxed">{description}</p></div></div>;
export default InstructionCard;
