"use client";
import { useEffect, useState } from 'react';
import { Workflow, ArrowLeft, LoaderCircle } from 'lucide-react';
import Dashboard from '../dashboard';
import '../portfolio/portfolio.css';

export default function VisitorDemo() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  async function start() {
    setError('');
    try {
      const response = await fetch('/api/demo/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not start the sandbox.');
      setReady(true);
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void start(); }, []);
  if (ready) return <Dashboard demo />;
  return <main className="portfolio-shell"><header className="portfolio-header"><a href="/portfolio"><Workflow /> IntegrationOS</a><span className="portfolio-badge">Interactive sandbox</span></header><section className="portfolio-hero"><p className="portfolio-eyebrow">YOUR WORKFLOW. YOUR TRACE.</p><h1>Make it<br /><em>happen.</em></h1>{error ? <div role="alert"><p>{error}</p><button className="primary" onClick={() => void start()}>Try again</button></div> : <p role="status"><LoaderCircle className="spin" size={18} /> Preparing your isolated sandbox…</p>}<a className="portfolio-explore" href="/portfolio"><ArrowLeft size={16} /> Back to portfolio</a></section></main>;
}
