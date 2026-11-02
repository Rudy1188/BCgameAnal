// Packs extension/ into site/download/bc-watchdog.zip (website) and store/bc-watchdog-<version>.zip (Chrome Web Store).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = `${root}site/download/bc-watchdog.zip`;
mkdirSync(`${root}site/download`, { recursive: true });
const { version } = JSON.parse(readFileSync(`${root}extension/manifest.json`, "utf8"));
const store = `${root}store/bc-watchdog-${version}.zip`;
mkdirSync(`${root}store`, { recursive: true });
rmSync(out, { force: true });
rmSync(store, { force: true });
// Zip the folder as "bc-watchdog/" so it unzips into one folder.
execFileSync("python3", ["-I", "-c", `
import os, sys, zipfile
src, out, store = sys.argv[1], sys.argv[2], sys.argv[3]
def pack(dest, prefix):
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        for folder, _, files in sorted(os.walk(src)):
            for name in sorted(files):
                path = os.path.join(folder, name)
                z.write(path, prefix + os.path.relpath(path, src))
pack(out, "bc-watchdog/")  # website download: unzips into one folder
pack(store, "")            # Chrome Web Store upload: manifest.json at the root
`, `${root}extension`, out, store]);
console.log(`Wrote ${out}\nWrote ${store}`);
