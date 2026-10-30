"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, LoaderCircle, Workflow } from "lucide-react";
import Dashboard from "../dashboard";
import { ShaderBackground } from "../../components/ui/calm-violet-silk-shader-hero-background";
import "./demo.css";

export default function VisitorDemo() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  async function start() {
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
    }
  }

  useEffect(() => { void start(); }, []);

  if (ready) return <Dashboard demo />;

  return (
    <main className="demo-boot">
      <div className="demo-boot-shader" aria-hidden="true">
        <ShaderBackground className="demo-intro-shader" />
      </div>
      <div className="demo-boot-card">
        <div className="demo-boot-brand"><Workflow size={27} /><span>Integration<em>OS</em></span></div>
        <p className="demo-boot-eyebrow">INTERACTIVE SANDBOX / ENGINE CORE</p>
        <h1>Workflows with<br />nothing to hide.</h1>
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <button type="button" className="primary" onClick={() => void start()}>Try again</button>
          </div>
        ) : (
          <p className="demo-boot-status" role="status">
            <LoaderCircle className="spin" size={19} /> Preparing your isolated sandbox…
          </p>
        )}
        <a href="/portfolio"><ArrowLeft size={14} style={{ verticalAlign: "middle" }} /> Back to portfolio</a>
      </div>
    </main>
  );
}
