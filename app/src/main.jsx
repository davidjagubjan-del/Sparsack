/**
 * Einstieg der App (Web, Android, iOS).
 * Vor dem ersten Render werden Plattform und Geräte-Kennung aus dem nativen Kontext
 * in window.COINCURB_* gelegt; CoinCurb.jsx schickt sie als X-Platform / X-Device-Id mit.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { Device } from "@capacitor/device";
import App from "../../CoinCurb.jsx";

window.COINCURB_API_BASE = import.meta.env.VITE_API_BASE || "";
window.COINCURB_PLATTFORM = Capacitor.getPlatform();          // "web" | "android" | "ios"

async function nativenKontextLaden() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { identifier } = await Device.getId();               // stabile Geräte-ID (Android: ANDROID_ID, iOS: identifierForVendor)
    if (identifier) window.COINCURB_GERAET_ID = identifier;
    const info = await Device.getInfo();
    if (info.isVirtual) window.COINCURB_EMULATOR = "1";
  } catch {
    /* ohne native Infos laeuft die App weiter, dann mit der lokalen Kennung aus CoinCurb.jsx */
  }
}

nativenKontextLaden().finally(() => {
  createRoot(document.getElementById("root")).render(<App />);
});
