"use client";

import { useState, type MouseEvent } from "react";
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight,
  CheckCircle2, CircleDot, Code2, GitBranch, Layers, ShieldCheck
} from "lucide-react";
import { ShaderBackground } from "../../components/ui/calm-violet-silk-shader-hero-background";
import BrandMark from "../../components/brand-mark";
import recorded from "./recorded-runs.json";
import "./portfolio.css";

function scrollToPortfolioSection(event: MouseEvent<HTMLAnchorElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.currentTarget.getAttribute("href");
  if (anchor !== "#capabilities" && anchor !== "#inspector") return;
  const section = document.querySelector<HTMLElement>(anchor);
  if (!section) return;
  event.preventDefault();
  window.history.pushState(null, "", anchor);
  section.scrollIntoView({
    block: "start",
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
}

const featured = recorded.runs[0];
const featuredStart = Math.min(featured.started_at, ...featured.spans.map(s => s.started_at));
const featuredEnd = Math.max(featured.finished_at || featuredStart, ...featured.spans.map(s => s.ended_at || s.started_at));
const featuredDuration = Math.max(1, featuredEnd - featuredStart);
const featuredSpans = featured.spans.filter(s => s.parent_id !== null).slice(0, 5);

function HeroTrace() {
  return (
    <div className="portfolio-hero-panel" aria-label="Recorded sandbox execution trace preview">
      <div className="portfolio-hero-panel-top">
        <div className="portfolio-panel-title"><CircleDot size={15} /><span>EXECUTION MONITOR</span></div>
        <span className="portfolio-panel-label"><span className="portfolio-panel-led" /> RECORDED SANDBOX</span>
      </div>
      <div className="portfolio-panel-intro">
        <div><span className="portfolio-panel-overline">WORKFLOW / 001</span><strong>{featured.workflow_name}</strong></div>
        <span className="portfolio-panel-success"><CheckCircle2 size={13} /> {featured.status}</span>
      </div>
      <div className="portfolio-panel-trace-id">TRACE ID <span>{featured.trace_id.slice(0, 20)}…</span></div>
      <div className="portfolio-panel-axis"><span>OPERATION</span><span>MEASURED TIMELINE</span></div>
      <div className="portfolio-panel-rows">
        {featuredSpans.map(s => {
          const elapsed = Math.max(0, (s.ended_at || s.started_at) - s.started_at);
          return (
            <div className="portfolio-panel-row" key={s.id}>
              <div className="portfolio-panel-operation"><span className={s.status === "error" ? "portfolio-node-dot is-error" : "portfolio-node-dot"} /><span>{s.name}</span></div>
              <div className="portfolio-panel-track">
                <span className={s.status === "error" ? "portfolio-panel-bar is-error" : "portfolio-panel-bar"} style={{
                  left: ((s.started_at - featuredStart) / featuredDuration * 100) + "%",
                  width: Math.max(2, elapsed / featuredDuration * 100) + "%"
                }} title={s.name + ": " + elapsed + " ms"} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="portfolio-panel-bottom">
        <div><span className="portfolio-panel-led" /> PERSISTED ENGINE TRACE</div>
        <strong>{featuredDuration.toLocaleString()} <small>MS</small></strong>
      </div>
      <div className="portfolio-panel-reflection" aria-hidden="true" />
    </div>
  );
}

export default function Portfolio() {
  const [selected, setSelected] = useState(0);
  const run = recorded.runs[selected];
  const start = Math.min(run.started_at, ...run.spans.map(s => s.started_at));
  const end = Math.max(run.finished_at || start, ...run.spans.map(s => s.ended_at || s.started_at));
  const duration = Math.max(end - start, 1);


  return (
    <main className="portfolio-shell">
      <header className="portfolio-header">
        <div className="portfolio-container portfolio-header-inner">
          <a href="/portfolio" className="portfolio-brand" aria-label="IntegrationOS portfolio">
            <span className="portfolio-brand-icon"><BrandMark size={38} /></span>
            <span>Integration<span>OS</span></span>
          </a>
          <nav className="portfolio-header-nav" aria-label="Portfolio navigation">
            <a className="portfolio-header-text-link" href="#capabilities" onClick={scrollToPortfolioSection}>Capabilities</a>
            <a className="portfolio-header-text-link" href="#inspector" onClick={scrollToPortfolioSection}>Execution traces</a>
            <a className="portfolio-header-cta" href="/demo">Open Studio <ArrowUpRight size={15} /></a>
          </nav>
        </div>
      </header>

      <section className="portfolio-hero" aria-labelledby="portfolio-hero-heading">
        <div className="portfolio-silk" aria-hidden="true"><ShaderBackground className="portfolio-silk-canvas" /></div>
        <div className="portfolio-hero-scrim" aria-hidden="true" />
        <div className="portfolio-container portfolio-hero-grid">
          <div className="portfolio-hero-copy">
            <div className="portfolio-hero-kicker portfolio-animate"><span className="portfolio-kicker-dot" /> WORKFLOW INTELLIGENCE <span className="portfolio-kicker-divider">/</span> PHASE 01</div>
            <h1 className="portfolio-animate" id="portfolio-hero-heading">Every system.<br /><em>In perfect sync.</em></h1>
            <p className="portfolio-hero-description portfolio-animate">
              Design the workflow. Orchestrate the execution. Inspect every decision. One powerful platform for the systems behind your business.
            </p>
            <div className="portfolio-hero-actions portfolio-animate">
              <a className="portfolio-primary-cta" href="/demo">Launch Workflow Studio <ArrowUpRight size={19} /></a>
              <a className="portfolio-secondary-cta" href="#inspector" onClick={scrollToPortfolioSection}>Explore execution traces <ArrowDownRight size={18} /></a>
            </div>
            <div className="portfolio-hero-trust portfolio-animate">
              <ShieldCheck size={16} />
              <span>Real engine execution. Isolated sandbox. No sign-in required.</span>
            </div>
            <div className="portfolio-hero-source portfolio-animate">
              <a className="portfolio-github-cta" href="https://github.com/ProdigyProjectStudios/integrations-os" target="_blank" rel="noopener noreferrer"><Code2 size={16} /> View source on GitHub <ArrowUpRight size={15} /></a>
            </div>
          </div>
          <HeroTrace />
        </div>
        <div className="portfolio-container portfolio-hero-bottom">
          <span>INTEGRATIONOS / ENGINEERING REFERENCE</span>
          <span><span className="portfolio-hero-bottom-line" /> BUILT TO BE OBSERVABLE</span>
        </div>
      </section>

      <section className="portfolio-proof-band" id="capabilities" aria-label="Platform capabilities">
        <div className="portfolio-container portfolio-proof-grid">
          <article><div className="portfolio-proof-icon"><GitBranch size={19} /></div><div><span>01 / ORCHESTRATE</span><h3>Design the system.</h3><p>Versioned, drag-and-drop workflows with branching and human decisions.</p></div></article>
          <article><div className="portfolio-proof-icon"><Activity size={19} /></div><div><span>02 / OBSERVE</span><h3>Follow every step.</h3><p>Measured execution spans, persisted outputs and precise failure context.</p></div></article>
          <article><div className="portfolio-proof-icon"><ShieldCheck size={19} /></div><div><span>03 / RECOVER</span><h3>Know what happened.</h3><p>Durable checkpoints, safe replay and conservative delivery handling.</p></div></article>
        </div>
      </section>

      <section className="portfolio-command portfolio-container" aria-label="Command Center">
        <div className="portfolio-section-title">
          <div><p className="portfolio-eyebrow">COMMAND CENTER / ENGINE EVIDENCE</p><h2>Beautiful systems.<br /><em>Verifiable outcomes.</em></h2></div>
          <p>Not a simulated dashboard. The figures below come from recorded executions in the same durable workflow engine used by the interactive Studio.</p>
        </div>
        <div className="portfolio-metrics">
          <article><Activity /><strong>{recorded.runs.length}</strong><span>Recorded sandbox executions</span></article>
          <article><Layers /><strong>{recorded.runs.reduce((n, r) => n + r.spans.length, 0)}</strong><span>Measured execution spans</span></article>
          <article><ShieldCheck /><strong>Isolated</strong><span>Real engine · synthetic provider data</span></article>
        </div>
      </section>

      <section id="inspector" className="portfolio-inspector portfolio-container">
        <div className="portfolio-section-title">
          <div><p className="portfolio-eyebrow">EXECUTION INSPECTOR / RECORD 001—{String(recorded.runs.length).padStart(3, "0")}</p><h2>Nothing behind<br /><em>the curtain.</em></h2></div>
          <span className="portfolio-recorded-tag"><span className="portfolio-panel-led" /> Recorded {recorded.generatedAt.slice(0, 10)}</span>
        </div>
        <p className="portfolio-caption">These spans were measured and persisted by the workflow engine using sandbox adapters. All displayed inputs are synthetic. This view contains no workspace data or administrative controls.</p>
        <div className="portfolio-run-tabs" aria-label="Recorded executions">
          {recorded.runs.map((r, i) => <button type="button" key={r.id} onClick={() => setSelected(i)} aria-pressed={selected === i}>
            <span className="portfolio-dot" /> Execution {String(i + 1).padStart(2, "0")}
            <small>{r.status}</small>
          </button>)}
        </div>
        <div className="portfolio-trace">
          <div className="portfolio-trace-head">
            <div><span className="portfolio-eyebrow">SELECTED EXECUTION</span><strong>{run.workflow_name}</strong><p>Trace <code>{run.trace_id}</code></p></div>
            <span>{duration.toLocaleString()} ms · {run.spans.length} measured spans</span>
          </div>
          <div className="portfolio-waterfall">
            <div className="portfolio-axis"><span>Service / operation</span><div><span>0 ms</span><span>{Math.round(duration / 2)} ms</span><span>{duration} ms</span></div></div>
            {run.spans.map(s => {
              const elapsed = Math.max(0, (s.ended_at || s.started_at) - s.started_at);
              return <div className="portfolio-span" key={s.id}>
                <div><strong>{s.name}</strong><small>{s.service} · {s.status}</small></div>
                <div className="portfolio-track">
                  <div className={"portfolio-bar " + (s.status === "error" ? "is-error" : "")} style={{
                    left: ((s.started_at - start) / duration * 100) + "%",
                    width: Math.max(0.8, elapsed / duration * 100) + "%"
                  }} title={s.name + ": " + elapsed + " ms"} />
                  <span>{elapsed} ms</span>
                </div>
              </div>;
            })}
          </div>
        </div>
      </section>
      <section className="portfolio-final-cta portfolio-container">
        <div><span className="portfolio-eyebrow">BUILT TO CONNECT. ENGINEERED TO EXPLAIN.</span><h2>Build something<br /><em>that actually runs.</em></h2></div>
        <a className="portfolio-primary-cta" href="/demo">Open the interactive Studio <ArrowRight size={19} /></a>
      </section>
      <footer className="portfolio-footer portfolio-container"><span>© 2026 IntegrationOS · A Digital Prodigy engineering reference</span><span>Phase 1 Core / Sandbox demonstration</span><a href="https://21st.dev/@dhxwhy/components/calm-violet-silk-shader-hero-background" target="_blank" rel="noopener noreferrer">Silk shader by DHxWhy / 21st.dev</a></footer>
    </main>
  );
}
