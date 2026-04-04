"use client";

import { useState, useEffect } from "react";

const GITHUB_REPO = "slopedrop/contop";

interface PlatformAsset {
  url: string;
  size: number;
  downloads: number;
  name: string;
}

interface ReleaseData {
  version: string;
  date: string;
  assets: {
    windows: PlatformAsset | null;
    android: PlatformAsset | null;
    macos: PlatformAsset | null;
  };
  totalDownloads: number;
}

function categorizeAsset(name: string): "windows" | "android" | "macos" | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".nsis.exe") || (lower.endsWith(".exe") && !lower.includes("uninstall")))
    return "windows";
  if (lower.endsWith(".apk")) return "android";
  if (lower.endsWith(".dmg")) return "macos";
  return null;
}

export function useGitHubRelease() {
  const [release, setRelease] = useState<ReleaseData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("GitHub API error");
        return res.json();
      })
      .then((data) => {
        const assets: ReleaseData["assets"] = {
          windows: null,
          android: null,
          macos: null,
        };

        let totalDownloads = 0;

        for (const asset of data.assets || []) {
          totalDownloads += asset.download_count || 0;
          const platform = categorizeAsset(asset.name);
          if (platform && !assets[platform]) {
            assets[platform] = {
              url: asset.browser_download_url,
              size: asset.size,
              downloads: asset.download_count || 0,
              name: asset.name,
            };
          }
        }

        setRelease({
          version: data.tag_name?.replace(/^(desktop-|mobile-)/, "") || data.tag_name,
          date: data.published_at,
          assets,
          totalDownloads,
        });
      })
      .catch(() => {
        // Silently fail — component shows fallback
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, []);

  return { release, loading };
}
