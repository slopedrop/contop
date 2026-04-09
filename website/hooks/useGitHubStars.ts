"use client";

import { useState, useEffect } from "react";

const GITHUB_REPO = "slopedrop/contop";

function formatCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return count.toString();
}

export function useGitHubStars() {
  const [stars, setStars] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("GitHub API error");
        return res.json();
      })
      .then((data) => {
        if (typeof data.stargazers_count === "number") {
          setStars(formatCount(data.stargazers_count));
        }
      })
      .catch(() => {
        // Silently fail - show icon only
      });

    return () => controller.abort();
  }, []);

  return stars;
}
