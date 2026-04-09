/**
 * Mermaid diagram zoom - click to expand fullscreen, click/Esc to close.
 * Uses MutationObserver because mermaid renders asynchronously after route change.
 */

function attachZoom(container) {
  if (container.dataset.zoomBound) return;
  container.dataset.zoomBound = 'true';

  container.addEventListener('click', (e) => {
    e.stopPropagation();
    container.classList.toggle('mermaid-zoomed');

    if (container.classList.contains('mermaid-zoomed')) {
      document.body.style.overflow = 'hidden';

      const closeOnEsc = (event) => {
        if (event.key === 'Escape') {
          container.classList.remove('mermaid-zoomed');
          document.body.style.overflow = '';
          document.removeEventListener('keydown', closeOnEsc);
        }
      };
      document.addEventListener('keydown', closeOnEsc);
    } else {
      document.body.style.overflow = '';
    }
  });
}

function bindAll() {
  document.querySelectorAll('.docusaurus-mermaid-container').forEach(attachZoom);
}

let observer = null;

export function onRouteDidUpdate() {
  // Bind any already-rendered diagrams
  bindAll();

  // Watch for mermaid containers added async after route change
  if (observer) observer.disconnect();

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.classList?.contains('docusaurus-mermaid-container')) {
          attachZoom(node);
        }
        // Also check children (mermaid container might be nested)
        if (node.querySelectorAll) {
          node.querySelectorAll('.docusaurus-mermaid-container').forEach(attachZoom);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Safety: also try after a delay in case rendering is batched
  setTimeout(bindAll, 1000);
  setTimeout(bindAll, 3000);
}
