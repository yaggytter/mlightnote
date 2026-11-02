// Vite plugin that writes third-party-licenses.txt next to the build: the
// name, version, licence and licence text of every npm package that ends
// up in the shipped JavaScript (main bundle and the engine Worker). The
// BSD/MIT/ISC licences of those packages require their notices to travel
// with the code. opensheetmusicdisplay ships pre-bundled (vexflow, jszip,
// …), so the runtime `dependencies` of every bundled package are included
// too.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin, Rollup } from "vite";

export const LICENSES_FILE = "third-party-licenses.txt";
const LICENSE_FILE_PATTERN = /^(licen[cs]e|copying|notice)([-.][\w.-]+)?$/i;
const README_PATTERN = /^readme(\.\w+)?$/i;

export interface PackageInfo {
  name: string;
  version: string;
  license: string;
  text: string;
}

/** The package root directory for a module id inside node_modules, or null. */
export function packageDirOf(moduleId: string): string | null {
  const id = moduleId.replace(/\\/g, "/").replace(/^\0/, "").split("?")[0];
  const at = id.lastIndexOf("/node_modules/");
  if (at < 0) return null;
  const rest = id.slice(at + "/node_modules/".length).split("/");
  const depth = rest[0]?.startsWith("@") ? 2 : 1;
  if (rest.length <= depth) return null;
  return id.slice(0, at) + "/node_modules/" + rest.slice(0, depth).join("/");
}

/** Finds an installed package the way Node does: walk up the node_modules dirs. */
function resolvePackageDir(name: string, fromDir: string): string | null {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The "License" section of a README, for packages that ship no licence file. */
export function licenseSectionOf(readme: string): string | null {
  const match = /^#{1,6}\s*licen[cs]e\b.*$/im.exec(readme);
  if (!match) return null;
  const rest = readme.slice(match.index + match[0].length);
  const end = rest.search(/^#{1,6}\s/m);
  return (end < 0 ? rest : rest.slice(0, end)).trim() || null;
}

/** What to print when a package carries no licence text at all. */
export function missingLicenseText(license: string, author: string | undefined): string {
  const by = author ? ` by ${author}` : "";
  return `This package${by} is distributed under the ${license} licence but ships no licence text.\nThe licence terms: https://spdx.org/licenses/${encodeURIComponent(license)}.html`;
}

function authorName(author: unknown): string | undefined {
  if (typeof author === "string") return author;
  if (author && typeof author === "object" && typeof (author as { name?: unknown }).name === "string") return (author as { name: string }).name;
  return undefined;
}

function readPackage(dir: string): { info: PackageInfo; dependencies: string[] } {
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
    license?: string;
    author?: unknown;
    dependencies?: Record<string, string>;
  };
  const license = pkg.license ?? "UNKNOWN";
  const files = readdirSync(dir);
  const licenseFile = files.find((f) => LICENSE_FILE_PATTERN.test(f));
  const readme = files.find((f) => README_PATTERN.test(f));
  const text = licenseFile
    ? readFileSync(path.join(dir, licenseFile), "utf8").trim()
    : (licenseSectionOf(readme ? readFileSync(path.join(dir, readme), "utf8") : "") ?? missingLicenseText(license, authorName(pkg.author)));
  return {
    info: {
      name: pkg.name ?? path.basename(dir),
      version: pkg.version ?? "",
      license,
      text,
    },
    dependencies: Object.keys(pkg.dependencies ?? {}),
  };
}

/** Collects the bundled packages and, transitively, their runtime dependencies. */
export function collectPackages(packageDirs: Iterable<string>): PackageInfo[] {
  const seen = new Map<string, PackageInfo>();
  const queue = [...packageDirs];
  while (queue.length > 0) {
    const dir = queue.pop()!;
    if (seen.has(dir)) continue;
    const { info, dependencies } = readPackage(dir);
    seen.set(dir, info);
    for (const dep of dependencies) {
      if (dep.startsWith("@types/")) continue; // type definitions are not shipped
      const depDir = resolvePackageDir(dep, dir);
      if (depDir && !seen.has(depDir)) queue.push(depDir);
    }
  }
  const unique = new Map([...seen.values()].map((p) => [`${p.name}@${p.version}`, p]));
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function formatLicenses(packages: readonly PackageInfo[]): string {
  const rule = "=".repeat(72);
  const header =
    "MLightNote — third-party software\n\n" +
    "The application bundles the following open-source packages.\n" +
    "Each is used under the licence reproduced below.\n";
  const sections = packages.map((p) => `${rule}\n${p.name} ${p.version} (${p.license})\n${rule}\n\n${p.text}\n`);
  return [header, ...sections].join("\n");
}

function packageDirsIn(bundle: Rollup.OutputBundle): string[] {
  return Object.values(bundle)
    .flatMap((output) => (output.type === "chunk" ? output.moduleIds : []))
    .map(packageDirOf)
    .filter((dir): dir is string => dir !== null);
}

/**
 * The plugin for the main build and a factory for the Worker build. Both
 * feed one list; the main build (which finishes after the Worker build)
 * writes it out.
 */
export function thirdPartyLicenses(): { main: Plugin; worker: () => Plugin } {
  const packageDirs = new Set<string>();
  const remember = (bundle: Rollup.OutputBundle): void => {
    for (const dir of packageDirsIn(bundle)) packageDirs.add(dir);
  };
  return {
    worker: () => ({
      name: "mlightnote:third-party-licenses-worker",
      apply: "build",
      generateBundle(_options, bundle) {
        remember(bundle);
      },
    }),
    main: {
      name: "mlightnote:third-party-licenses",
      apply: "build",
      generateBundle(_options, bundle) {
        remember(bundle);
        this.emitFile({ type: "asset", fileName: LICENSES_FILE, source: formatLicenses(collectPackages(packageDirs)) });
      },
    },
  };
}
