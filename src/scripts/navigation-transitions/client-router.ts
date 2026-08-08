import { resolveRouteTransition, type RouteTransition } from './route-model';

const root = document.documentElement;
let requestedDestination = '';

function setTransitionAttributes(
  target: HTMLElement,
  transition: RouteTransition,
  includeSharedElements = true,
) {
  target.dataset.vtTier = document.startViewTransition
    ? 'same-document-native'
    : 'client-fallback';
  target.dataset.navDirection = transition.relationship;
  target.dataset.navFrom = transition.from.kind;
  target.dataset.navTo = transition.to.kind;
  if (includeSharedElements && transition.types.includes('about-edge')) {
    target.dataset.navAboutEdge = '';
  }
  else delete target.dataset.navAboutEdge;
}

function clearTransitionAttributes(doc: Document) {
  const target = doc.documentElement;
  delete target.dataset.navDirection;
  delete target.dataset.navFrom;
  delete target.dataset.navTo;
  delete target.dataset.navAboutEdge;
}

function copyThemeState(newDocument: Document) {
  const nextRoot = newDocument.documentElement;
  for (const attribute of ['data-theme', 'data-theme-mode', 'data-theme-family']) {
    const value = root.getAttribute(attribute);
    if (value !== null) nextRoot.setAttribute(attribute, value);
  }
  for (const property of ['--vt-bg', 'background-color', 'color-scheme']) {
    const value = root.style.getPropertyValue(property);
    if (value) nextRoot.style.setProperty(property, value);
  }
}

function normalizedDestination(url: URL) {
  return `${url.origin}${url.pathname.replace(/\/+$/, '') || '/'}${url.search}`;
}

document.addEventListener('astro:before-preparation', (event) => {
  clearTransitionAttributes(document);
  requestedDestination = normalizedDestination(event.to);

  const transition = resolveRouteTransition(event.from, event.to);
  setTransitionAttributes(root, transition);
});

document.addEventListener('astro:before-swap', (event) => {
  const transition = resolveRouteTransition(event.from, event.to);
  const redirected = requestedDestination !== normalizedDestination(event.to);

  copyThemeState(event.newDocument);
  setTransitionAttributes(root, transition, !redirected);
  setTransitionAttributes(event.newDocument.documentElement, transition, !redirected);

  const types = redirected
    ? [transition.relationship === 'neutral' ? 'neutral' : `to-${transition.relationship}`]
    : transition.types;
  if (event.viewTransition.types?.add) {
    for (const type of types) event.viewTransition.types.add(type);
  }

  event.viewTransition.finished.then(
    () => clearTransitionAttributes(document),
    () => clearTransitionAttributes(document),
  );
});

document.addEventListener('astro:page-load', () => {
  root.dataset.vtTier = document.startViewTransition
    ? 'same-document-native'
    : 'client-fallback';
});
