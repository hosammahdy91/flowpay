"use client";

import { useEffect } from "react";
import { setCookie, getCookie } from "cookies-next";

export default function Callback() {
  useEffect(() => {
    (async () => {
      try {
        const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");

        const dt = (getCookie("deviceToken") as string) || "";
        const dk = (getCookie("deviceKey") as string) || "";
        const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID as string;
        const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID as string;
        const callbackUrl = "https://flowpay-bay.vercel.app/callback";

        new W3SSdk(
          {
            appSettings: { appId },
            loginConfigs: {
              deviceToken: dt,
              deviceEncryptionKey: dk,
              google: {
                clientId: googleClientId,
                redirectUri: callbackUrl,
                selectAccountPrompt: true,
              },
            },
          },
          (err: unknown, res: any) => {
            if (!err && res?.userToken) {
              setCookie("ut", res.userToken, { maxAge: 60 * 60 * 24 });
              setCookie("ek", res.encryptionKey, { maxAge: 60 * 60 * 24 });
            }
            window.location.href = "/";
          }
        );
      } catch (e) {
        console.error("Callback error:", e);
        window.location.href = "/";
      }
    })();
  }, []);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f5f4f0",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
    }}>
      <div style={{
        width: 36,
        height: 36,
        border: "3px solid rgba(0,82,255,0.15)",
        borderTop: "3px solid #0052ff",
        borderRadius: "50%",
        animation: "spin 0.7s linear infinite",
      }} />
      <p style={{ color: "#888880", fontSize: 14, fontFamily: "sans-serif" }}>
        Completing sign-in...
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}