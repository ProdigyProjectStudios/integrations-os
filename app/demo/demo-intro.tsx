"use client";

import { Activity, ArrowDownRight, ArrowUpRight, Check, CircleDot, GitBranch, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { ShaderBackground } from "../../components/ui/calm-violet-silk-shader-hero-background";

type Props = {
  engineStatus: "online" | "connecting" | "offline";
  onInspect: () => void;
};

const stages = [
  { code: "01", name: "Trigger", detail: "Receive an event", icon: CircleDot },
  { code: "02", name: "Orchestrate", detail: "Route & transform", icon: GitBranch },
  { code: "03", name: "Trace", detail: "Persist the outcome", icon: Activity },
];

export default function DemoIntro({ engineStatus, onInspect }: Props) {
  const connected = engineStatus === "online";

  return (
    <section className="demo-intro" data-enter aria-labelledby="demo-studio-title">
      <div className="demo-intro-silk" aria-hidden="true">
        <ShaderBackground className="demo-intro-shader" />
      </div>
      <div className="demo-intro-wash" aria-hidden="true" />
      <div className="demo-intro-content">
        <div className="demo-intro-copy">
          <div className="demo-intro-eyebrow">
            <span className="demo-intro-asterisk"><Sparkles size={12} /></span>
            INTERACTIVE WORKFLOW STUDIO <span className="demo-intro-eyebrow-sep">/</span> CORE 01
          </div>
          <h1 id="demo-studio-title">Build the flow.<br /><em>See the proof.</em></h1>
          <p>Design, publish and execute workflows on a real, persistent engine. Then inspect every step in the execution timeline.</p>
          <div className="demo-intro-actions">
            <a className="demo-intro-primary" href="#workflow-studio">
              Explore the canvas <ArrowDownRight size={17} />
            </a>
            <button type="button" className="demo-intro-secondary" onClick={onInspect}>
              Inspect executions <ArrowUpRight size={16} />
            </button>
          </div>
        </div>
        <div className="demo-intro-diagram" aria-label="Illustrative path through the workflow engine">
          <div className="demo-intro-diagram-bar">
            <span><Workflow size={15} /> EXECUTION PATH</span>
            <span className="demo-intro-diagram-mode">SANDBOX</span>
          </div>
          <div className="demo-intro-stages">
            {stages.map((stage, index) => (
              <div className="demo-intro-stage" key={stage.code}>
                <span className="demo-intro-stage-index">{stage.code}</span>
                <span className="demo-intro-stage-icon"><stage.icon size={17} /></span>
                <div><strong>{stage.name}</strong><small>{stage.detail}</small></div>
                {index === stages.length - 1 ? <Check className="demo-intro-stage-done" size={17} /> : <span className="demo-intro-stage-connector" />}
              </div>
            ))}
          </div>
          <div className="demo-intro-diagram-footer">
            <div><ShieldCheck size={14} /> Illustrative flow · real engine below</div>
            <span className={"demo-intro-status status-" + engineStatus}>
              <i />{connected ? "ENGINE CONNECTED" : engineStatus === "offline" ? "CONNECTION INTERRUPTED" : "CONNECTING"}
            </span>
          </div>
        </div>
      </div>
      <div className="demo-intro-footnotes">
        <span>NO SIGN-IN <i /> 24-HOUR PRIVATE SANDBOX</span>
        <span><span className="demo-intro-line" /> SIMULATED PROVIDERS · MEASURED TRACES</span>
      </div>
    </section>
  );
}
