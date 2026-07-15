import esbuild from "esbuild";
import process from "process";
import { copyFileSync, existsSync, readFileSync } from "fs";

// Hardcoded Node.js built-in module names (replaces the builtin-modules package)
const builtins = [
  "assert", "buffer", "child_process", "cluster", "console", "constants",
  "crypto", "dgram", "dns", "domain", "events", "fs", "http", "https",
  "module", "net", "os", "path", "perf_hooks", "process", "punycode",
  "querystring", "readline", "repl", "stream", "string_decoder", "sys",
  "timers", "tls", "tty", "url", "util", "v8", "vm", "worker_threads", "zlib",
];

// Load .env if present (personal vault path — not committed to git)
if (existsSync(".env")) {
  readFileSync(".env", "utf8").split("\n").forEach((line) => {
    const [key, ...val] = line.trim().split("=");
    if (key && val.length && !process.env[key]) {
      process.env[key] = val.join("=");
    }
  });
}

const prod = process.argv[2] === "production";

// Copy to vault after build — set VAULT_PATH env var to your vault path
// e.g. VAULT_PATH=/path/to/your/vault npm run dev
// Without VAULT_PATH, the copy step is skipped (build still succeeds)
const vaultPlugin = process.env.VAULT_PATH
  ? `${process.env.VAULT_PATH}/.obsidian/plugins/ledgr`
  : null;

const copyPlugin = {
  name: "copy-to-vault",
  setup(build) {
    build.onEnd(() => {
      if (!vaultPlugin) {
        console.log("VAULT_PATH not set — skipping copy to vault");
        return;
      }
      if (!existsSync(vaultPlugin)) {
        console.log(`Vault plugin path not found: ${vaultPlugin} — skipping copy`);
        return;
      }
      copyFileSync("main.js", `${vaultPlugin}/main.js`);
      copyFileSync("manifest.json", `${vaultPlugin}/manifest.json`);
      if (existsSync("styles.css")) copyFileSync("styles.css", `${vaultPlugin}/styles.css`);
      console.log("Copied to vault");
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  plugins: [copyPlugin],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
