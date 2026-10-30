"use client";
import { useState } from 'react';
import { Activity, ArrowUpRight, Layers, ShieldCheck, Workflow } from 'lucide-react';
import recorded from './recorded-runs.json';
import './portfolio.css';

export default function Portfolio() {
  const [selected, setSelected] = useState(0);
  const run = recorded.runs[selected];
  const start = Math.min(run.started_at, ...run.spans.map(s => s.started_at));
  const end = Math.max(run.finished_at || start, ...run.spans.map(s => s.ended_at || s.started_at));
  const duration = Math.max(end - start, 1);
  return <main className="portfolio-shell">
    <header className="portfolio-header"><a href="/portfolio" aria-label="IntegrationOS portfolio"><Workflow size={25} /> Integration<span>OS</span></a><span className="portfolio-badge"><ShieldCheck size={14} /> Read-only portfolio</span></header>
    <section className="portfolio-hero"><p className="portfolio-eyebrow">SYSTEMS IN SYNC. EVERY STEP VISIBLE.</p><h1>From event<br />to <em>evidence.</em></h1><p>A workflow engine you can see working. Explore measured execution traces, durable orchestration and the paths between your systems.</p><a className="portfolio-explore" href="#inspector">Explore the execution <ArrowUpRight size={18} /></a><div className="portfolio-orbit" aria-hidden="true"><Workflow size={72} /></div></section>
    <section className="portfolio-command" aria-label="Command Center"><div><p className="portfolio-eyebrow">COMMAND CENTER</p><h2>Operational clarity.</h2></div><div className="portfolio-metrics"><article><Activity /><strong>{recorded.runs.length}</strong><span>Recorded executions</span></article><article><Layers /><strong>{recorded.runs.reduce((n,r)=>n+r.spans.length,0)}</strong><span>Measured spans</span></article><article><ShieldCheck /><strong>Sandbox</strong><span>Real engine · synthetic inputs</span></article></div></section>
    <section id="inspector" className="portfolio-inspector"><div className="portfolio-section-title"><div><p className="portfolio-eyebrow">EXECUTION INSPECTOR</p><h2>Nothing behind the curtain.</h2></div><span className="portfolio-badge">Recorded · {recorded.generatedAt.slice(0,10)}</span></div><p className="portfolio-caption">These traces were recorded by the repository’s workflow engine using sandbox adapters. Timings are measured. This public view contains no workspace data or administrative actions.</p>
      <div className="portfolio-run-tabs" aria-label="Recorded executions">{recorded.runs.map((r,i)=><button key={r.id} onClick={()=>setSelected(i)} aria-pressed={selected===i}><span className="portfolio-dot" /> Execution 0{i+1}<small>{r.status}</small></button>)}</div>
      <div className="portfolio-trace"><div className="portfolio-trace-head"><div><strong>{run.workflow_name}</strong><p>Trace <code>{run.trace_id}</code></p></div><span>{duration.toLocaleString()} ms · {run.spans.length} spans</span></div>
        <div className="portfolio-waterfall"><div className="portfolio-axis"><span>Service / operation</span><div><span>0 ms</span><span>{Math.round(duration/2)} ms</span><span>{duration} ms</span></div></div>{run.spans.map(s=><div className="portfolio-span" key={s.id}><div><strong>{s.name}</strong><small>{s.service} · {s.status}</small></div><div className="portfolio-track"><div className={'portfolio-bar '+(s.status==='error'?'is-error':'')} style={{left:((s.started_at-start)/duration*100)+'%',width:Math.max(.8,((s.ended_at||s.started_at)-s.started_at)/duration*100)+'%'}} title={`${s.name}: ${(s.ended_at||s.started_at)-s.started_at} ms`} /><span>{(s.ended_at||s.started_at)-s.started_at} ms</span></div></div>)}</div>
      </div></section><footer className="portfolio-footer"><span>IntegrationOS / Phase 1</span><span>Orchestration. Observability. Proof.</span></footer>
  </main>;
}
