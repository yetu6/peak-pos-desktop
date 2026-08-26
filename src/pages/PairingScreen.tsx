import { useState } from "react";
import { Icon } from "../components/Icon";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { rawPublicKeyB64Url } from "../lib/deviceCrypto";

export function PairingScreen() {
  const { identity, error, commission } = useDeviceSession();
  const [terminalId, setTerminalId] = useState("");
  const [credential, setCredential] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  async function connect() { if (!terminalId.trim() || !credential.trim() || busy) return; setBusy(true);setLocalError(null);try{await commission(terminalId,credential,name)}catch{setLocalError("Peak rejected this terminal registration. Ask a manager to register it again.")}finally{setBusy(false)} }
  return <div className="auth-shell flex h-screen items-center justify-center p-6" data-testid="pairing-screen"><span className="sr-only" data-testid="shell-state">UNPAIRED</span><div className="glass-panel w-full max-w-lg p-8">
    <div className="mb-6 flex items-center justify-center gap-2"><Icon name="peak-logo" size={28} className="text-[#D4A017]"/><span className="font-display text-2xl text-[var(--color-text-primary)]">Commission Peak POS</span></div>
    <p className="text-sm text-[var(--color-text-secondary)]">Ask an authorized property manager to register this terminal against the correct outlet using the public key below. Enter the one-time registration result here.</p>
    <label className="mt-5 block text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Terminal public key</label><div className="mt-1 break-all rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-hover)] p-3 font-mono text-[11px]" data-testid="terminal-public-key">{identity?.publicKeySpki ? rawPublicKeyB64Url(identity.publicKeySpki) : "Generating key…"}</div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs text-[var(--color-text-secondary)]">Terminal ID<input className="input mt-1 w-full" value={terminalId} onChange={(e)=>setTerminalId(e.target.value)} autoComplete="off"/></label><label className="text-xs text-[var(--color-text-secondary)]">Terminal name<input className="input mt-1 w-full" value={name} onChange={(e)=>setName(e.target.value)} placeholder="Restaurant POS 01"/></label></div>
    <label className="mt-3 block text-xs text-[var(--color-text-secondary)]">One-time device credential<input type="password" className="input mt-1 w-full font-mono" value={credential} onChange={(e)=>setCredential(e.target.value)} autoComplete="new-password"/></label>
    <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">The credential is stored with the terminal identity and is never shown again in Peak.</p>
    {(localError||error)?<div className="badge badge-danger mt-4" data-testid="pairing-error">{localError||error}</div>:null}<button className="btn-primary mt-6 w-full" disabled={busy||!terminalId.trim()||!credential.trim()} onClick={()=>void connect()}>{busy?"Verifying terminal…":"Verify and bind terminal"}</button>
  </div></div>;
}
