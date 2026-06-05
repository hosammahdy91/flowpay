"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { setCookie, getCookie } from "cookies-next";
import { SocialLoginProvider } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";

const APP_ID = process.env.NEXT_PUBLIC_CIRCLE_APP_ID as string;
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID as string;
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000") + "/callback";

type Session = { userToken: string; encryptionKey: string };
type Wallet = { id: string; address: string; blockchain: string };
type Status = "idle" | "loading" | "success" | "error";
type Tab = "send" | "receive" | "history";
type Currency = "USDC" | "EURC" | "cirBTC";
type Tx = { type: "send" | "receive"; addr: string; amount: string };
type Stage = "boot" | "device" | "login" | "session" | "challenge" | "ready";

export default function FlowPay() {
  const sdk = useRef<W3SSdk | null>(null);
  const [stage, setStage] = useState<Stage>("boot");
  const [deviceId, setDeviceId] = useState("");
  const [deviceToken, setDeviceToken] = useState("");
  const [deviceKey, setDeviceKey] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [challengeId, setChallengeId] = useState("");
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [balance, setBalance] = useState("0.00");
  const [tab, setTab] = useState<Tab>("send");
  const [toAddr, setToAddr] = useState("");
  const [currency, setCurrency] = useState<"USDC" | "EURC" | "cirBTC">("USDC");
  const [eurcBalance, setEurcBalance] = useState("0.00");
  const [cirbtcBalance, setCirbtcBalance] = useState("0.00000000");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<Status>("idle");
  const [txs, setTxs] = useState<Tx[]>([]);
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState(false);
  const [scanning, setScanning] = useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const scannerRef = React.useRef<any>(null);

  const msg = (s: string, t: Status = "idle") => { setStatus(s); setStatusType(t); };
  const pop = (s: string) => { setToast(s); setTimeout(() => setToast(""), 3000); };

  const reset = () => {
    localStorage.clear();
    document.cookie.split(";").forEach(c => {
      document.cookie = c.replace(/^ +/, "").replace(/=.*/, `=;expires=${new Date(0).toUTCString()};path=/`);
    });
    window.location.reload();
  };

  // ── QR Scanner ──
  const startScanner = async () => {
    setScanning(true);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/library");
      const codeReader = new BrowserQRCodeReader();
      scannerRef.current = codeReader;
      const videoInputDevices = await codeReader.listVideoInputDevices();
      // الكاميرا الخلفية أولاً
      const backCamera = videoInputDevices.find(d =>
        d.label.toLowerCase().includes("back") ||
        d.label.toLowerCase().includes("rear") ||
        d.label.toLowerCase().includes("environment")
      );
      const deviceId = backCamera?.deviceId || videoInputDevices[videoInputDevices.length - 1]?.deviceId;
      await codeReader.decodeFromVideoDevice(deviceId, videoRef.current!, (result, err) => {
        if (result) {
          setToAddr(result.getText());
          stopScanner();
          pop("✓ Address scanned!");
        }
      });
    } catch { setScanning(false); pop("Camera not available"); }
  };

  const stopScanner = () => {
    if (scannerRef.current) {
      scannerRef.current.reset();
      scannerRef.current = null;
    }
    setScanning(false);
  };

  // ── Init SDK ──
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const { W3SSdk: SDK } = await import("@circle-fin/w3s-pw-web-sdk");

        const onLogin = (err: unknown, res: any) => {
          if (dead) return;
          if (err || !res?.userToken) { msg("Sign-in failed. Please try again.", "error"); return; }
          setCookie("ut", res.userToken);
          setCookie("ek", res.encryptionKey);
          setSession({ userToken: res.userToken, encryptionKey: res.encryptionKey });
          setStage("session");
          msg("Signed in successfully ✓", "success");
        };

        const dt = (getCookie("deviceToken") as string) || "";
        const dk = (getCookie("deviceKey") as string) || "";

        const instance = new SDK(
          {
            appSettings: { appId: APP_ID },
            loginConfigs: {
              deviceToken: dt,
              deviceEncryptionKey: dk,
              google: { clientId: GOOGLE_CLIENT_ID, redirectUri: APP_URL, selectAccountPrompt: true },
            },
          },
          onLogin
        );

        sdk.current = instance;
        if (!dead) {
          // استعادة session بعد redirect من Google
          const savedUt = getCookie("ut") as string;
          const savedEk = getCookie("ek") as string;
          if (savedUt && savedEk) {
            setSession({ userToken: savedUt, encryptionKey: savedEk });
            setStage("session");
            msg("Session restored. Continue setup.", "success");
          } else {
            setStage("device");
          }
        }
      } catch { if (!dead) msg("Failed to load SDK", "error"); }
    })();
    return () => { dead = true; };
  }, []);

  // ── Fetch deviceId ──
  useEffect(() => {
    if (stage !== "device" || !sdk.current) return;
    (async () => {
      try {
        const cached = localStorage.getItem("did");
        if (cached) { setDeviceId(cached); return; }
        const id = await sdk.current!.getDeviceId();
        setDeviceId(id);
        localStorage.setItem("did", id);
      } catch { msg("Could not get device ID", "error"); }
    })();
  }, [stage]);

  // ── Load balance ──
  const loadBalance = useCallback(async (ut: string, wid: string) => {
    const r = await fetch("/api/endpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "getBalance", userToken: ut, walletId: wid }),
    });
    const d = await r.json();
    if (!r.ok) return;
    const tokens = (d.tokenBalances as any[]) || [];
    const usdc = tokens.find(t => t.token?.symbol?.startsWith("USDC") || t.token?.name?.includes("USDC"));
    const eurc = tokens.find(t => t.token?.symbol?.startsWith("EURC") || t.token?.name?.includes("EURC"));
    const cirbtc = tokens.find(t => t.token?.symbol?.startsWith("cirBTC") || t.token?.name?.includes("cirBTC"));
    setBalance(usdc?.amount ?? "0.00");
    setEurcBalance(eurc?.amount ?? "0.00");
    setCirbtcBalance(cirbtc?.amount ?? "0.00000000");
  }, []);

  // ── Load wallets ──
  const loadWallets = useCallback(async (ut: string) => {
    msg("Loading wallet...", "loading");
    const r = await fetch("/api/endpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "listWallets", userToken: ut }),
    });
    const d = await r.json();
    if (!r.ok) { msg("Failed to load wallet", "error"); return; }
    const ws = (d.wallets as Wallet[]) || [];
    if (ws[0]) {
      setWallet(ws[0]);
      await loadBalance(ut, ws[0].id);
      setStage("ready");
      msg("Wallet ready ✓", "success");
    }
  }, [loadBalance]);

  // ── Step 1: Device Token ──
  const createDeviceToken = async () => {
    if (!deviceId) return;
    msg("Creating device session...", "loading");
    const r = await fetch("/api/endpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createDeviceToken", deviceId }),
    });
    const d = await r.json();
    if (!r.ok) {
      if (d.code === 155140 || JSON.stringify(d).includes("device ID")) { reset(); return; }
      msg("Failed to create device session", "error");
      return;
    }
    setDeviceToken(d.deviceToken);
    setDeviceKey(d.deviceEncryptionKey);
    setCookie("deviceToken", d.deviceToken);
    setCookie("deviceKey", d.deviceEncryptionKey);
    sdk.current?.updateConfigs({
      appSettings: { appId: APP_ID },
      loginConfigs: {
        deviceToken: d.deviceToken,
        deviceEncryptionKey: d.deviceEncryptionKey,
        google: { clientId: GOOGLE_CLIENT_ID, redirectUri: APP_URL, selectAccountPrompt: true },
      },
    });
    setStage("login");
    msg("Device session ready. Sign in with Google.", "success");
  };

  // ── Step 2: Google Login ──
  const signInWithGoogle = () => {
    if (!sdk.current || !deviceToken) return;
    sdk.current.updateConfigs({
      appSettings: { appId: APP_ID },
      loginConfigs: {
        deviceToken,
        deviceEncryptionKey: deviceKey,
        google: { clientId: GOOGLE_CLIENT_ID, redirectUri: APP_URL, selectAccountPrompt: true },
      },
    });
    msg("Opening Google sign-in...", "loading");
    try {
      // محاولة استخدام popup بدل redirect
      (sdk.current as any).performLogin(SocialLoginProvider.GOOGLE, { mode: "popup" });
    } catch {
      sdk.current!.performLogin(SocialLoginProvider.GOOGLE);
    }
  };

  // ── Step 3: Initialize User ──
  const initUser = async () => {
    if (!session) return;
    msg("Setting up account...", "loading");
    const r = await fetch("/api/endpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "initializeUser", userToken: session.userToken }),
    });
    const d = await r.json();
    if (!r.ok) {
      if (d.code === 155106) { await loadWallets(session.userToken); return; }
      msg("Setup failed: " + (d.message || d.error), "error");
      return;
    }
    setChallengeId(d.challengeId);
    setStage("challenge");
    msg("Account ready. Create your wallet.", "success");
  };

  // ── Step 4: Create Wallet ──
  const createWallet = () => {
    if (!sdk.current || !challengeId || !session) return;
    sdk.current.setAuthentication({ userToken: session.userToken, encryptionKey: session.encryptionKey });
    msg("Creating wallet...", "loading");
    sdk.current.execute(challengeId, async (err) => {
      if (err) { msg("Wallet creation failed: " + ((err as any)?.message ?? ""), "error"); return; }
      setChallengeId("");
      msg("Wallet created! Loading...", "loading");
      setTimeout(() => loadWallets(session!.userToken), 2000);
    });
  };

  // ── Send USDC ──
  const sendUsdc = async () => {
    if (!session || !wallet || !toAddr || !amount) return;
    if (parseFloat(amount) <= 0) { pop("Enter a valid amount"); return; }
    if (parseFloat(amount) > parseFloat(balance)) { pop("Insufficient balance"); return; }

    setSending(true);
    msg(`Sending ${amount} USDC...`, "loading");

    const r = await fetch("/api/endpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "sendUsdc",
        userToken: session.userToken,
        walletId: wallet.id,
        destinationAddress: toAddr,
        amount,
        currency,
      }),
    });
    const d = await r.json();
    if (!r.ok) { msg("Transfer failed: " + (d.message || d.error), "error"); setSending(false); return; }
    if (!sdk.current || !d.challengeId) { setSending(false); return; }

    sdk.current.setAuthentication({ userToken: session.userToken, encryptionKey: session.encryptionKey });
    sdk.current.execute(d.challengeId, async (err) => {
      if (err) { msg("Signing failed: " + ((err as any)?.message ?? ""), "error"); setSending(false); return; }
      setTxs(p => [{ type: "send", addr: toAddr, amount: amount + " " + currency }, ...p]);
      setToAddr(""); setAmount("");
      pop("✓ Transfer complete!");
      msg("Transfer successful ✓", "success");
      setSending(false);
      setTimeout(() => loadBalance(session!.userToken, wallet!.id), 3000);
    });
  };

  const copyAddr = () => {
    if (!wallet) return;
    navigator.clipboard.writeText(wallet.address);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
    pop("Address copied ✓");
  };

  const stepIdx = { boot: 0, device: 0, login: 1, session: 2, challenge: 3, ready: 4 }[stage];

  return (
    <div className="shell">
      {/* Header */}
      <header className="header">
        <div className="logo">
          <div className="logo-icon">⚡</div>
          FlowPay
        </div>
        <span className="badge">Arc Testnet</span>
      </header>

      <main className="main">
        {/* ── Setup Flow ── */}
        {stage !== "ready" && (
          <>
            <div className="steps">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`step ${i < stepIdx ? "done" : i === stepIdx ? "active" : ""}`} />
              ))}
            </div>

            <div className="card">
              <p className="card-title">Wallet Setup</p>

              {/* Step 1 */}
              <button
                className="btn btn-secondary"
                onClick={createDeviceToken}
                disabled={!deviceId || stage !== "device"}
              >
                {statusType === "loading" && stage === "device"
                  ? <><div className="spinner-dark" /> Preparing...</>
                  : "① Create Device Session"}
              </button>

              {/* Step 2 */}
              <button
                className="btn btn-google"
                onClick={signInWithGoogle}
                disabled={stage !== "login"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                ② Sign in with Google
              </button>

              {/* Step 3 */}
              <button
                className="btn btn-secondary"
                onClick={initUser}
                disabled={stage !== "session"}
              >
                ③ Set Up Account
              </button>

              {/* Step 4 */}
              <button
                className="btn btn-primary"
                onClick={createWallet}
                disabled={stage !== "challenge"}
              >
                {statusType === "loading" && stage === "challenge"
                  ? <><div className="spinner" /> Creating wallet...</>
                  : "④ Create Wallet"}
              </button>

              {status && (
                <div className="status">
                  <div className={`status-dot ${statusType}`} />
                  <span>{status}</span>
                </div>
              )}
            </div>

            {/* Reset */}
            <button
              onClick={reset}
              style={{ display: "block", margin: "8px auto 0", background: "none", border: "none", fontSize: 12, color: "var(--text-muted)", cursor: "pointer", textDecoration: "underline" }}
            >
              Reset & start over
            </button>
          </>
        )}

        {/* ── Wallet UI ── */}
        {stage === "ready" && wallet && (
          <>
            {/* Balance */}
            <div className="balance-card">
              <p className="balance-label">Your balance</p>
              <div className="balance-amount">
                {currency === "cirBTC"
                  ? parseFloat(cirbtcBalance).toFixed(6)
                  : parseFloat(currency === "USDC" ? balance : eurcBalance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="balance-currency">
                <div className="live-dot" /> Arc Testnet
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, position: "relative", zIndex: 1 }}>
                <button
                  onClick={() => setCurrency("USDC")}
                  style={{ flex: 1, padding: "8px", borderRadius: 10, border: "1px solid " + (currency === "USDC" ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.1)"), background: currency === "USDC" ? "rgba(255,255,255,0.15)" : "transparent", color: "white", cursor: "pointer", fontSize: 13, fontWeight: 500 }}
                >
                  USDC · {parseFloat(balance).toFixed(2)}
                </button>
                <button
                  onClick={() => setCurrency("EURC")}
                  style={{ flex: 1, padding: "8px", borderRadius: 10, border: "1px solid " + (currency === "EURC" ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.1)"), background: currency === "EURC" ? "rgba(255,255,255,0.15)" : "transparent", color: "white", cursor: "pointer", fontSize: 13, fontWeight: 500 }}
                >
                  EURC · {parseFloat(eurcBalance).toFixed(2)}
                </button>
                <button
                  onClick={() => setCurrency("cirBTC")}
                  style={{ flex: 1, padding: "8px", borderRadius: 10, border: "1px solid " + (currency === "cirBTC" ? "rgba(255,181,0,0.5)" : "rgba(255,255,255,0.1)"), background: currency === "cirBTC" ? "rgba(255,181,0,0.2)" : "transparent", color: currency === "cirBTC" ? "#ffb500" : "white", cursor: "pointer", fontSize: 11, fontWeight: 500 }}
                >
                  cirBTC · {parseFloat(cirbtcBalance).toFixed(6)}
                </button>
              </div>
              <div className="addr-chip" onClick={copyAddr}>
                <span className="addr-text">{wallet.address}</span>
                <span className="copy-btn">{copied ? "✓" : "⎘"}</span>
              </div>
            </div>

            {/* Tabs */}
            <div className="tabs">
              <button className={`tab ${tab === "send" ? "active" : ""}`} onClick={() => setTab("send")}>Send</button>
              <button className={`tab ${tab === "receive" ? "active" : ""}`} onClick={() => setTab("receive")}>Receive</button>
              <button className={`tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>History</button>
            </div>

            {/* Send */}
            {tab === "send" && (
              <div className="card">
                <p className="card-title">Send USDC</p>
                <div className="field">
                  <label className="field-label">Recipient address</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input className="input input-mono" placeholder="0x..." value={toAddr} onChange={e => setToAddr(e.target.value)} style={{ flex: 1 }} />
                    <button
                      onClick={scanning ? stopScanner : startScanner}
                      style={{ flexShrink: 0, padding: "0 14px", background: scanning ? "var(--red-light)" : "var(--accent-light)", border: "1px solid " + (scanning ? "rgba(230,57,70,0.3)" : "rgba(0,82,255,0.2)"), borderRadius: "var(--radius-sm)", cursor: "pointer", fontSize: 18, color: scanning ? "var(--red)" : "var(--accent)", transition: "all 0.15s" }}
                      title={scanning ? "Stop scanning" : "Scan QR code"}
                    >
                      {scanning ? "✕" : "⌗"}
                    </button>
                  </div>
                  {scanning && (
                    <div style={{ marginTop: 12, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)", position: "relative" }}>
                      <video ref={videoRef} style={{ width: "100%", display: "block", maxHeight: 200, objectFit: "cover" }} autoPlay muted playsInline />
                      <div style={{ position: "absolute", inset: 0, border: "2px solid var(--accent)", borderRadius: 12, pointerEvents: "none" }} />
                      <p style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)", padding: "8px", background: "var(--bg2)" }}>Point camera at QR code</p>
                    </div>
                  )}
                </div>
                <div className="field">
                  <label className="field-label">Amount</label>
                  <div className="amount-wrap">
                    <span className="amount-prefix">{currency}</span>
                    <input className="input" type="number" placeholder="0.00" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
                  </div>
                </div>
                <button className="btn btn-primary" onClick={sendUsdc} disabled={sending || !toAddr || !amount}>
                  {sending ? <><div className="spinner" /> Sending...</> : `Send ${amount || "0"} ${currency} →`}
                </button>
                {status && (
                  <div className="status">
                    <div className={`status-dot ${statusType}`} />
                    <span>{status}</span>
                  </div>
                )}
              </div>
            )}

            {/* Receive */}
            {tab === "receive" && (
              <div className="card">
                <p className="card-title">Receive USDC</p>
                <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20, lineHeight: 1.6 }}>
                  Scan the QR code or share your address to receive USDC.
                </p>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "20px 0" }}>
                  <div style={{ background: "white", padding: 16, borderRadius: 16, border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}>
                    <img src={"https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + encodeURIComponent(wallet.address) + "&bgcolor=ffffff&color=0d0d0d&margin=0"} alt="QR Code" width={180} height={180} style={{ display: "block", borderRadius: 4 }} />
                  </div>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textAlign: "center" }}>{wallet.address.slice(0, 10)}...{wallet.address.slice(-8)}</p>
                </div>
                <div className="field">
                  <label className="field-label">Full wallet address</label>
                  <div className="addr-chip" onClick={copyAddr} style={{ background: "var(--bg3)", color: "var(--text-muted)", borderColor: "var(--border)" }}>
                    <span className="addr-text">{wallet.address}</span>
                    <span className="copy-btn">{copied ? "✓" : "⎘"}</span>
                  </div>
                </div>
                <div className="divider">or get test USDC</div>
                <button className="btn btn-secondary" onClick={() => window.open("https://faucet.circle.com", "_blank")}>
                  Open Faucet → faucet.circle.com ↗
                </button>
                <p className="faucet-note">Select <strong>Arc Testnet</strong> and paste your address</p>
              </div>
            )}

            {/* History */}
            {tab === "history" && (
              <div className="card">
                <p className="card-title">Transaction History</p>
                {txs.length === 0 ? (
                  <div className="empty">
                    <div className="empty-icon">📭</div>
                    No transactions yet
                  </div>
                ) : (
                  txs.map((tx, i) => (
                    <div className="tx" key={i}>
                      <div className={`tx-icon ${tx.type}`}>{tx.type === "send" ? "↑" : "↓"}</div>
                      <div className="tx-info">
                        <div className="tx-type">{tx.type === "send" ? "Sent" : "Received"}</div>
                        <div className="tx-addr">{tx.addr.slice(0, 8)}...{tx.addr.slice(-6)}</div>
                      </div>
                      <div className={`tx-amount ${tx.type}`}>{tx.type === "send" ? "−" : "+"}{tx.amount} USDC</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}