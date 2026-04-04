/**
 * Mobile search portal — moves search bar to document.body on focus
 * so that fixed positioning works regardless of ancestor CSS properties.
 * Listens via MutationObserver since the search plugin renders asynchronously.
 */

const MOBILE_BREAKPOINT = 996;

let originalParent = null;
let originalNextSibling = null;
let backdrop = null;
let isPortaled = false;
let isTransitioning = false; // prevents blur during portal-out

function isMobile() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

function getSearchBarContainer() {
  return document.querySelector('[class*="searchBarContainer"]');
}

function createBackdrop() {
  const el = document.createElement('div');
  el.className = 'search-portal-backdrop';
  el.addEventListener('click', closePortal);
  return el;
}

function closePortal() {
  if (!isPortaled) return;

  // Find the search bar container (now a child of body)
  const container = document.body.querySelector(':scope > [class*="searchBarContainer"]');
  if (!container) return;

  const input = container.querySelector('.navbar__search-input');
  if (input) input.blur();

  portalBack(container);
}

function portalOut(container) {
  if (isPortaled || isTransitioning) return;
  isTransitioning = true;

  originalParent = container.parentNode;
  originalNextSibling = container.nextSibling;

  // Create and insert backdrop
  backdrop = createBackdrop();
  document.body.appendChild(backdrop);

  // Move search container to body
  document.body.appendChild(container);
  isPortaled = true;
  document.body.classList.add('search-portal-active');

  // Re-focus the input since moving the node blurs it
  requestAnimationFrame(() => {
    const input = container.querySelector('.navbar__search-input');
    if (input) {
      input.focus();
    }
    // Allow blur handler to work again after focus is restored
    setTimeout(() => {
      isTransitioning = false;
    }, 100);
  });
}

function portalBack(container) {
  if (!isPortaled) return;
  isPortaled = false;
  isTransitioning = false;
  document.body.classList.remove('search-portal-active');

  // Move search container back to its original position
  if (originalParent) {
    originalParent.insertBefore(container, originalNextSibling);
  }

  // Remove backdrop
  if (backdrop && backdrop.parentNode) {
    backdrop.parentNode.removeChild(backdrop);
  }
  backdrop = null;
}

function bindSearchInput() {
  const input = document.querySelector('.navbar .navbar__search-input');
  if (!input || input.dataset.portalBound) return;
  input.dataset.portalBound = 'true';

  const container = input.closest('[class*="searchBarContainer"]');
  if (!container) return;

  input.addEventListener('focus', () => {
    if (!isMobile() || isTransitioning) return;
    portalOut(container);
  });

  input.addEventListener('blur', () => {
    if (!isPortaled || isTransitioning) return;
    // Delay to allow click events on search results to fire
    setTimeout(() => {
      if (isPortaled && !isTransitioning) {
        portalBack(container);
      }
    }, 200);
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isPortaled) {
      closePortal();
    }
  });
}

let observer = null;

export function onRouteDidUpdate() {
  bindSearchInput();

  // Watch for search bar added async after route change
  if (observer) observer.disconnect();

  observer = new MutationObserver(() => {
    if (!isPortaled && !isTransitioning) {
      bindSearchInput();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Safety retries
  setTimeout(bindSearchInput, 500);
  setTimeout(bindSearchInput, 2000);
}
