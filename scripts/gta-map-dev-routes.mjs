const ROUTE_TO_ARTIFACT = new Map([
  ["/viz/gta-crime-map", "/viz/gta-crime-map.html"],
  ["/viz/gta-crime-map-lite", "/viz/gta-crime-map-lite.html"],
]);

export function rewriteGtaMapRequest(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (typeof request.url !== "string") return false;

  const queryStart = request.url.indexOf("?");
  const pathname =
    queryStart === -1 ? request.url : request.url.slice(0, queryStart);
  const artifactPath = ROUTE_TO_ARTIFACT.get(pathname);

  if (!artifactPath) return false;

  const query = queryStart === -1 ? "" : request.url.slice(queryStart);
  request.url = `${artifactPath}${query}`;
  return true;
}

export default function gtaMapDevRoutes() {
  return {
    name: "gta-map-dev-routes",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        rewriteGtaMapRequest(request);
        next();
      });
    },
  };
}
