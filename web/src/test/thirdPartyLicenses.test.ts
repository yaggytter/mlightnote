// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectPackages, formatLicenses, licenseSectionOf, missingLicenseText, packageDirOf } from "../../thirdPartyLicenses.ts";

// The build ships third-party-licenses.txt (web/thirdPartyLicenses.ts) so
// that the notices required by the bundled packages' licences travel with
// the code.
const NODE_MODULES = path.resolve(__dirname, "../../../node_modules");

describe("packageDirOf", () => {
  it("finds the package root of a plain and a scoped module", () => {
    expect(packageDirOf("/r/node_modules/react/cjs/react.js")).toBe("/r/node_modules/react");
    expect(packageDirOf("/r/node_modules/@scope/pkg/dist/i.js?worker")).toBe("/r/node_modules/@scope/pkg");
  });

  it("uses the innermost node_modules and ignores app modules", () => {
    expect(packageDirOf("/r/node_modules/a/node_modules/b/i.js")).toBe("/r/node_modules/a/node_modules/b");
    expect(packageDirOf("/r/web/src/main.tsx")).toBeNull();
    expect(packageDirOf("\0vite/preload-helper.js")).toBeNull();
  });
});

describe("collectPackages", () => {
  it("includes the packages pre-bundled inside opensheetmusicdisplay, with their licence text", () => {
    const packages = collectPackages([path.join(NODE_MODULES, "opensheetmusicdisplay")]);
    const names = packages.map((p) => p.name);

    expect(names).toEqual(expect.arrayContaining(["opensheetmusicdisplay", "vexflow", "jszip", "loglevel"]));
    expect(names.some((n) => n.startsWith("@types/"))).toBe(false);
    const osmd = packages.find((p) => p.name === "opensheetmusicdisplay")!;
    expect(osmd.license).toBe("BSD-3-Clause");
    expect(osmd.text).toMatch(/Redistribution and use in source and binary forms/);
  });
});

describe("formatLicenses", () => {
  it("lists each package with its version, licence and text", () => {
    const text = formatLicenses([{ name: "a", version: "1.0.0", license: "MIT", text: "MIT text" }]);
    expect(text).toContain("a 1.0.0 (MIT)");
    expect(text).toContain("MIT text");
  });
});

describe("licenseSectionOf", () => {
  it("takes the License section of a README up to the next heading", () => {
    expect(licenseSectionOf("# x\n\nintro\n\n## License\n\nMIT, (c) Someone\n\n## Other\n\nno")).toBe("MIT, (c) Someone");
  });

  it("returns null when the README has no licence section", () => {
    expect(licenseSectionOf("# x\n\nnothing here")).toBeNull();
  });
});

describe("missingLicenseText", () => {
  it("names the author and points at the SPDX licence text", () => {
    const text = missingLicenseText("ISC", "Someone");
    expect(text).toContain("by Someone");
    expect(text).toContain("https://spdx.org/licenses/ISC.html");
  });
});
