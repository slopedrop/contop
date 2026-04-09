// ── Request Pacer ───────────────────────────────────────────────────
//
// Enforces natural timing between requests to simulate human usage.
// Minimum gap: 800ms, maximum: 2000ms, with random jitter.
//

const MIN_GAP_MS = 800;
const MAX_GAP_MS = 2000;

/**
 * RequestPacer enforces a natural delay between consecutive requests.
 *
 * This prevents burst patterns that would be detectable by provider
 * telemetry - a developer using a CLI doesn't send 10 requests/second.
 */
export class RequestPacer {
  private lastRequestTime = 0;

  /**
   * Wait if necessary to enforce minimum gap with random jitter.
   * Returns immediately if enough time has passed since last request.
   */
  async pace(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;

    const targetGap = MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);

    if (elapsed < targetGap) {
      const waitMs = targetGap - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    this.lastRequestTime = Date.now();
  }
}
