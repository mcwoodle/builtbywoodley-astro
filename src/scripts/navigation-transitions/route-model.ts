export type RouteRelationship = 'left' | 'right' | 'up' | 'down' | 'neutral';

type RoutePoint = {
  x: number;
  y: number;
};

export type TransitionRoute = {
  kind:
    | 'home'
    | 'about'
    | 'photography'
    | 'software-index'
    | 'software-detail'
    | 'blog-index'
    | 'blog-detail'
    | 'not-found'
    | 'unknown';
  path: string;
  point: RoutePoint | null;
};

export type RouteTransition = {
  from: TransitionRoute;
  to: TransitionRoute;
  relationship: RouteRelationship;
  types: string[];
};

export function normalizePath(url: URL | string): string {
  const parsed = typeof url === 'string' ? new URL(url, 'https://navigation.invalid') : url;
  const path = parsed.pathname.replace(/\/+$/, '');
  return path || '/';
}

export function classifyRoute(url: URL | string): TransitionRoute {
  const path = normalizePath(url);

  if (path === '/') return { kind: 'home', path, point: { x: 0, y: 0 } };
  if (path === '/about') return { kind: 'about', path, point: { x: 0, y: 1 } };
  if (path === '/photography' || path.startsWith('/photography/')) {
    return { kind: 'photography', path, point: { x: -1, y: 0 } };
  }
  if (path === '/software') {
    return { kind: 'software-index', path, point: { x: 1, y: 0 } };
  }
  if (path.startsWith('/software/')) {
    return { kind: 'software-detail', path, point: { x: 2, y: 0 } };
  }
  if (path === '/blog' || path === '/mocked/blog') {
    return { kind: 'blog-index', path, point: { x: 1, y: 0 } };
  }
  if (path.startsWith('/blog/') || path.startsWith('/mocked/blog/')) {
    return { kind: 'blog-detail', path, point: { x: 2, y: 0 } };
  }
  if (path === '/404') return { kind: 'not-found', path, point: null };

  return { kind: 'unknown', path, point: null };
}

function relationshipBetween(from: TransitionRoute, to: TransitionRoute): RouteRelationship {
  if (!from.point || !to.point) return 'neutral';

  // Project cards should feel like opening content in place rather than
  // moving to another horizontal section. Keep the inverse transition the
  // same so browser Back does not introduce a swipe unexpectedly.
  const isSoftwareProjectEdge =
    (from.kind === 'software-index' && to.kind === 'software-detail') ||
    (from.kind === 'software-detail' && to.kind === 'software-index');
  if (isSoftwareProjectEdge) return 'neutral';

  const dx = to.point.x - from.point.x;
  const dy = to.point.y - from.point.y;

  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? 'right' : 'left';
  if (dy !== 0) return dy > 0 ? 'down' : 'up';
  return 'neutral';
}

export function resolveRouteTransition(fromUrl: URL, toUrl: URL): RouteTransition {
  const from = classifyRoute(fromUrl);
  const to = classifyRoute(toUrl);
  const relationship = relationshipBetween(from, to);
  const types = [relationship === 'neutral' ? 'neutral' : `to-${relationship}`];

  if (from.kind === 'home' || to.kind === 'home') {
    types.push('home-edge', from.kind === 'home' ? 'from-home' : 'to-home');
  }
  if (
    (from.kind === 'home' && to.kind === 'about') ||
    (from.kind === 'about' && to.kind === 'home')
  ) {
    types.push('about-edge');
  }
  if (from.kind === 'software-index' && to.kind === 'software-detail') {
    types.push('to-detail');
  } else if (from.kind === 'software-detail' && to.kind === 'software-index') {
    types.push('from-detail');
  }

  return { from, to, relationship, types };
}
