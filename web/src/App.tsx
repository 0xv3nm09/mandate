import { useEffect, useState } from 'react';
import { ShieldCheck, Home as HomeIcon, LayoutDashboard, TerminalSquare, FlaskConical, Github, OctagonPause } from 'lucide-react';
import { api } from './lib/api';
import { Home } from './components/Home';
import { Dashboard } from './components/Dashboard';
import { Console } from './components/Console';
import { Usecases } from './components/Usecases';
import { useSSE } from './hooks/useSSE';

type Page = 'home' | 'dashboard' | 'console' | 'usecases';

// GitHub repo — shown in the header once public (private while in review)
const REPO_URL = 'https://github.com/0xv3nm09/mandate';

export default function App() {
  const [page, setPage] = useState<Page>(() => (location.hash.replace('#', '') as Page) || 'home');
  const [halted, setHalted] = useState(false);
  const [modes, setModes] = useState<{ paypal: string; llm: string } | null>(null);

  useEffect(() => {
    location.hash = page;
  }, [page]);

  useEffect(() => {
    const onHash = () => {
      const h = location.hash.replace('#', '') as Page;
      if (h === 'home' || h === 'dashboard' || h === 'console' || h === 'usecases') setPage(h);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    api<{ halted: boolean; mode: { paypal: string; llm: string } }>('/health')
      .then((h) => {
        setHalted(h.halted);
        setModes(h.mode);
      })
      .catch(() => {});
  }, []);

  useSSE((type, data) => {
    if (type === 'system.halt') setHalted((data as { halted: boolean }).halted);
    if (type === 'hello') setModes((data as { mode: { paypal: string; llm: string } }).mode);
  });

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-edge bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
          <button className="flex items-center gap-2" onClick={() => setPage('home')}>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-purple-500 to-fuchsia-500 text-white shadow-glow">
              <ShieldCheck size={17} />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">
              Mandate<span className="text-aurora">.</span>
            </span>
            <span className="hidden text-[11px] text-slate-500 sm:inline">the trust layer for agentic money movement</span>
          </button>

          <nav className="ml-auto flex items-center gap-1">
            <NavBtn active={page === 'home'} onClick={() => setPage('home')} icon={<HomeIcon size={14} />} label="Home" />
            <NavBtn active={page === 'dashboard'} onClick={() => setPage('dashboard')} icon={<LayoutDashboard size={14} />} label="Dashboard" />
            <NavBtn active={page === 'console'} onClick={() => setPage('console')} icon={<TerminalSquare size={14} />} label="Console" />
            <NavBtn active={page === 'usecases'} onClick={() => setPage('usecases')} icon={<FlaskConical size={14} />} label="Usecases" />
            {modes && (
              <span className="ml-2 hidden rounded-full border border-edge bg-raised px-2.5 py-1 text-[10px] text-muted lg:inline">
                PayPal: <b className="text-slate-300">{modes.paypal}</b> · agent: <b className="text-slate-300">{modes.llm}</b>
              </span>
            )}
            {halted && (
              <span className="ml-2 flex items-center gap-1 rounded-full border border-danger/40 bg-danger/15 px-2.5 py-1 text-[10px] font-bold text-danger animate-pulse-soft">
                <OctagonPause size={11} /> AGENT HALTED
              </span>
            )}
            {REPO_URL ? (
              <a
                className="ml-2 hidden items-center gap-1.5 rounded-full border border-edge bg-raised px-2.5 py-1 text-[11px] text-muted hover:text-ink sm:flex"
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                title="Open-source repo"
              >
                <Github size={12} /> OSS
              </a>
            ) : (
              <span className="ml-2 hidden items-center gap-1.5 rounded-full border border-edge bg-raised px-2.5 py-1 text-[11px] text-muted sm:flex" title="MIT-licensed open source — repo link set at build time">
                <Github size={12} /> OSS · MIT
              </span>
            )}
          </nav>
        </div>
      </header>

      {halted && (
        <div className="border-b border-danger/30 bg-danger/10 px-4 py-1.5 text-center text-xs text-danger">
          Global stop engaged — the agent is halted and every queued approval is frozen. Resume from the Console.
        </div>
      )}

      <main>
        {page === 'home' && <Home go={setPage} />}
        {page === 'dashboard' && <Dashboard go={setPage} />}
        {page === 'console' && <Console halted={halted} onHaltChange={setHalted} />}
        {page === 'usecases' && <Usecases />}
      </main>

      <footer className="border-t border-edge py-6 text-center text-[11px] text-slate-500">
        <p>
          <b className="text-slate-400">Mandate</b> — built for the PayPal AI Hackathon · sandbox money only ·
          aligned with AP2 (“verifiable intent, not inferred action”) · open source
        </p>
        <p className="mt-1">Mandate is an independent product concept and is not affiliated with or endorsed by PayPal.</p>
      </footer>
    </div>
  );
}

function NavBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: JSX.Element; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`btn px-3 py-1.5 text-[13px] ${active ? 'bg-accent/15 text-indigo-200 border border-accent/40' : 'text-muted border border-transparent hover:text-ink'}`}
    >
      {icon} {label}
    </button>
  );
}
