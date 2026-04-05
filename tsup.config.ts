import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm"],
  dts: true,
  minify: true,
  treeshake: true,
  clean: true,
  sourcemap: false,
  target: "es2023",
  splitting: false,
  external: ["react", "@react-email/render", "@nextnode-solutions/logger"],
  outDir: "dist",
});
