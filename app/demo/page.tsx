"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, GitBranch, LoaderCircle, ShieldCheck } from "lucide-react";
import Dashboard from "../dashboard";
import BrandMark from "../../components/brand-mark";
import "./demo.css";

export default function VisitorDemo() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [showStaging, setShowStaging] = useState(false);
  const inFlight = useRef(false);

  async function start() {
    if (inFlight.current) return;
    inFlight.current = true;
    setError("");
    try {
      const response = await fetch("/api/demo/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not start the sandbox.");
      setReady(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
    }
  }

  useEffect(() => {
    // A fast session bootstrap transitions directly into the Studio.
    // Only show the matching Studio skeleton when initialization takes longer.
    const timer = window.setTimeout(() => setShowStaging(true), 220);
    void start();
    return () => window.clearTimeout(timer);
  }, []);

  if (ready) return <Dashboard demo />;

  return (
    <main className={"demo-staging" + (showStaging || error ? " is-visible" : "")}>
      <aside className="demo-staging-sidebar" aria-hidden="true">
        <div className="demo-staging-brand">
          <BrandMark size={45} />
          <span>Integration<em>OS</em></span>
        </div>
        <div className="demo-staging-environment"><ShieldCheck size={15} /> SANDBOX ENVIRONMENT</div>
        <div className="demo-staging-section-label">WORKSPACE</div>
        <div className="demo-staging-nav-row" />
        <div className="demo-staging-nav-row is-active" />
        <div className="demo-staging-nav-row" />
      </aside>
      <div className="demo-staging-main">
        <header className="demo-staging-topbar">
          <span>WORKSPACE <ArrowRight size={12} /> WORKFLOW STUDIO</span>
          <span><span className="demo-staging-light" /> ISOLATED SANDBOX</span>
        </header>
        <div className="demo-staging-body">
          <div className="demo-staging-heading">
            <span className="demo-staging-eyebrow">INTEGRATION OPERATIONS / STUDIO</span>
            <div className="demo-staging-heading-row">
              <div>
                <h1>Workflow Studio<span>.</span></h1>
                <p>Design the flow. Inspect the execution.</p>
              </div>
              <GitBranch size={26} />
            </div>
          </div>
          <div className="demo-staging-workbench" aria-hidden="true">
            <div className="demo-staging-toolbar">
              <span className="demo-staging-pill" />
              <span className="demo-staging-pill is-short" />
            </div>
            <div className="demo-staging-workspace">
              <div className="demo-staging-palette">
                <span className="demo-staging-palette-label" />
                <span className="demo-staging-skeleton-row" />
                <span className="demo-staging-skeleton-row" />
                <span className="demo-staging-skeleton-row" />
                <span className="demo-staging-skeleton-row" />
              </div>
              <div className="demo-staging-canvas">
                <div className="demo-staging-canvas-grid" />
                <div className="demo-staging-nodes"><i /><i /><i /></div>
              </div>
            </div>
          </div>
          {error ? (
            <div className="demo-staging-error" role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => void start()}>Retry connection</button>
            </div>
          ) : (
            <p className="demo-staging-status" role="status">
              <LoaderCircle size={16} className="spin" />
              Establishing your private workflow sandbox…
            </p>
          )}
          <a className="demo-staging-back" href="/portfolio"><ArrowLeft size={14} /> Back to portfolio</a>
        </div>
      </div>
    </main>
  );
}
