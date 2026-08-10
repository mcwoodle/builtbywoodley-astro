import assert from "node:assert/strict";
import test from "node:test";

import gtaMapDevRoutes, {
  rewriteGtaMapRequest,
} from "../../scripts/gta-map-dev-routes.mjs";

function rewrite(method, url) {
  const request = { method, url };
  const rewritten = rewriteGtaMapRequest(request);
  return { rewritten, url: request.url };
}

test("rewrites exact GET and HEAD map routes", () => {
  assert.deepEqual(rewrite("GET", "/viz/gta-crime-map"), {
    rewritten: true,
    url: "/viz/gta-crime-map.html",
  });
  assert.deepEqual(rewrite("HEAD", "/viz/gta-crime-map-lite"), {
    rewritten: true,
    url: "/viz/gta-crime-map-lite.html",
  });
});

test("preserves query strings for full and lite routes", () => {
  assert.deepEqual(rewrite("GET", "/viz/gta-crime-map?view=3d&year=2024"), {
    rewritten: true,
    url: "/viz/gta-crime-map.html?view=3d&year=2024",
  });
  assert.deepEqual(rewrite("HEAD", "/viz/gta-crime-map-lite?device=touch"), {
    rewritten: true,
    url: "/viz/gta-crime-map-lite.html?device=touch",
  });
});

test("does not rewrite unsupported methods, HTML paths, or near matches", () => {
  for (const [method, url] of [
    ["POST", "/viz/gta-crime-map"],
    ["GET", "/viz/gta-crime-map.html"],
    ["GET", "/viz/gta-crime-map-lite.html"],
    ["GET", "/viz/gta-crime-map/"],
    ["GET", "/viz/gta-crime-map-lighter"],
    ["GET", "/viz/gta-crime-data"],
  ]) {
    assert.deepEqual(rewrite(method, url), { rewritten: false, url });
  }
});

test("registers serve-only Vite middleware", () => {
  const plugin = gtaMapDevRoutes();
  let middleware;
  plugin.configureServer({
    middlewares: {
      use(candidate) {
        middleware = candidate;
      },
    },
  });

  let nextCalled = false;
  const request = { method: "GET", url: "/viz/gta-crime-map" };
  middleware(request, {}, () => {
    nextCalled = true;
  });

  assert.equal(plugin.apply, "serve");
  assert.equal(request.url, "/viz/gta-crime-map.html");
  assert.equal(nextCalled, true);
});
