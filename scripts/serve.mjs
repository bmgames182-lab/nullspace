import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.PORT || 8000);
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
};
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost"),
        path = url.pathname === "/" ? "/client/index.html" : url.pathname;
      const file = resolve(root, "." + decodeURIComponent(path));
      if (
        !file.startsWith(root) ||
        (!file.startsWith(resolve(root, "client") + sep) &&
          !file.startsWith(resolve(root, "node_modules") + sep))
      )
        throw Error("path");
      let content = await readFile(file);
      if (extname(file) === ".html")
        content = content
          .toString()
          .replace(
            "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js",
            "/node_modules/three/build/three.module.js",
          )
          .replace(
            "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/",
            "/node_modules/three/examples/jsm/",
          )
          .replace(
            "https://esm.sh/@dimforge/rapier3d-compat@0.19.0",
            "/node_modules/@dimforge/rapier3d-compat/rapier.mjs",
          )
          .replace('src="./euphoria_lab.js"', 'src="/client/euphoria_lab.js"');
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`Active Body Lab: http://127.0.0.1:${port}`),
  );
