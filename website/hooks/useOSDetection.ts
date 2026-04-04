"use client";

import { useState, useEffect } from "react";

export type OS = "windows" | "macos" | "linux" | "android" | "ios" | "unknown";

interface OSDetection {
  os: OS;
  isMobile: boolean;
}

function detect(): OSDetection {
  if (typeof window === "undefined") return { os: "unknown", isMobile: false };

  let os: OS = "unknown";

  // Prefer User-Agent Client Hints (Chromium)
  const uaData = (navigator as any).userAgentData;
  if (uaData?.platform) {
    const p = uaData.platform.toLowerCase();
    if (p.includes("win")) os = "windows";
    else if (p.includes("mac")) os = "macos";
    else if (p.includes("linux")) os = "linux";
    else if (p.includes("android")) os = "android";

    if (os !== "unknown") {
      return { os, isMobile: uaData.mobile || os === "android" };
    }
  }

  // Fallback to userAgent string
  const ua = navigator.userAgent.toLowerCase();
  if (/android/.test(ua)) os = "android";
  else if (/iphone|ipad|ipod/.test(ua)) os = "ios";
  else if (/win/.test(ua)) os = "windows";
  else if (/macintosh|mac os/.test(ua)) os = "macos";
  else if (/linux/.test(ua)) os = "linux";

  const isMobile = os === "android" || os === "ios";
  return { os, isMobile };
}

export function useOSDetection(): OSDetection {
  const [result, setResult] = useState<OSDetection>({
    os: "unknown",
    isMobile: false,
  });

  useEffect(() => {
    setResult(detect());
  }, []);

  return result;
}
