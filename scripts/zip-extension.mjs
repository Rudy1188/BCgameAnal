// Packs extension/ into site/download/bc-watchdog.zip for the website's download button.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = `${root}site/download/bc-watchdog.zip`;
mkdirSync(`${root}site/download`, { recursive: true });
rmSync(out, { force: true });
// Zip the folder as "bc-watchdog/" so it unzips into one folder.
execFileSync("python3", ["-I", "-c", `
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for name in sorted(os.listdir(src)):
        z.write(os.path.join(src, name), "bc-watchdog/" + name)
`, `${root}extension`, out]);
console.log(`Wrote ${out}`);
