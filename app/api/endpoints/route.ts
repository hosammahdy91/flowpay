import { NextResponse } from "next/server";

const BASE = "https://api.circle.com";
const KEY = process.env.CIRCLE_API_KEY as string;

export async function POST(request: Request) {
  try {
    const { action, ...p } = await request.json();

    switch (action) {

      case "createDeviceToken": {
        const r = await fetch(`${BASE}/v1/w3s/users/social/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
          body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), deviceId: p.deviceId }),
        });
        const d = await r.json();
        if (!r.ok) return NextResponse.json(d, { status: r.status });
        return NextResponse.json(d.data);
      }

      case "initializeUser": {
        const r = await fetch(`${BASE}/v1/w3s/user/initialize`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, "X-User-Token": p.userToken },
          body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), accountType: "SCA", blockchains: ["ARC-TESTNET"] }),
        });
        const d = await r.json();
        if (!r.ok) return NextResponse.json(d, { status: r.status });
        return NextResponse.json(d.data);
      }

      case "listWallets": {
        const r = await fetch(`${BASE}/v1/w3s/wallets`, {
          headers: { accept: "application/json", Authorization: `Bearer ${KEY}`, "X-User-Token": p.userToken },
        });
        const d = await r.json();
        if (!r.ok) return NextResponse.json(d, { status: r.status });
        return NextResponse.json(d.data);
      }

      case "getBalance": {
        const r = await fetch(`${BASE}/v1/w3s/wallets/${p.walletId}/balances`, {
          headers: { accept: "application/json", Authorization: `Bearer ${KEY}`, "X-User-Token": p.userToken },
        });
        const d = await r.json();
        if (!r.ok) return NextResponse.json(d, { status: r.status });
        return NextResponse.json(d.data);
      }

      case "sendUsdc": {
        const tokenAddress = p.currency === "EURC"
          ? "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"
          : "0x3600000000000000000000000000000000000000";

        const payload: any = {
          idempotencyKey: crypto.randomUUID(),
          walletId: p.walletId,
          destinationAddress: p.destinationAddress,
          amounts: [String(p.amount)],
          feeLevel: "MEDIUM",
          tokenAddress,
          blockchain: "ARC-TESTNET",
        };
        console.log("Transfer payload:", JSON.stringify(payload));
        const r = await fetch(`${BASE}/v1/w3s/user/transactions/transfer`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, "X-User-Token": p.userToken },
          body: JSON.stringify(payload),
        });
        const d = await r.json();
        if (!r.ok) { console.log("Transfer error:", JSON.stringify(d)); return NextResponse.json(d, { status: r.status }); }
        return NextResponse.json(d.data);
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}