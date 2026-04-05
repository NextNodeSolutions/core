import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

function readJson(relativePath: string): Record<string, unknown> {
  const content = readFileSync(resolve(ROOT, relativePath), "utf-8");
  return JSON.parse(content) as Record<string, unknown>;
}

function fileExists(relativePath: string): boolean {
  return existsSync(resolve(ROOT, relativePath));
}

describe("FR-1: Package identity", () => {
  const pkg = readJson("package.json") as Record<string, unknown>;

  it("has correct package name", () => {
    expect(pkg.name).toBe("@nextnode-solutions/email-manager");
  });

  it("is type module", () => {
    expect(pkg.type).toBe("module");
  });

  it("requires Node.js >= 24.0.0", () => {
    const engines = pkg.engines as Record<string, string>;
    expect(engines.node).toBe(">=24.0.0");
  });

  it("uses pnpm as package manager", () => {
    expect(pkg.packageManager).toMatch(/^pnpm@/);
  });
});

describe("FR-3: Build configuration", () => {
  it("tsup.config.ts exists", () => {
    expect(fileExists("tsup.config.ts")).toBe(true);
  });
});

describe("FR-4: nextnode.toml", () => {
  it("exists at repo root", () => {
    expect(fileExists("nextnode.toml")).toBe(true);
  });

  it("contains correct project config", () => {
    const content = readFileSync(resolve(ROOT, "nextnode.toml"), "utf-8");
    expect(content).toContain("[project]");
    expect(content).toContain('name = "email-manager"');
    expect(content).toContain('type = "package"');
    expect(content).toContain("[scripts]");
    expect(content).toContain("[package]");
    expect(content).toContain('scope = "@nextnode-solutions"');
    expect(content).toContain('access = "public"');
  });
});

describe("FR-28: Package exports", () => {
  const pkg = readJson("package.json") as Record<string, unknown>;
  const exports = pkg.exports as Record<string, Record<string, string>>;

  it('has single entry point "."', () => {
    expect(exports["."]).toBeDefined();
  });

  it("maps types to ./dist/index.d.ts", () => {
    expect(exports["."]?.types).toBe("./dist/index.d.ts");
  });

  it("maps import to ./dist/index.js", () => {
    expect(exports["."]?.import).toBe("./dist/index.js");
  });
});

describe("FR-29: Package scripts", () => {
  const pkg = readJson("package.json") as Record<string, unknown>;
  const scripts = pkg.scripts as Record<string, string>;

  const requiredScripts = [
    "prebuild",
    "build",
    "clean",
    "lint",
    "format",
    "format:check",
    "test",
    "test:watch",
    "test:coverage",
    "type-check",
    "prepare",
    "commitlint",
    "lint-staged",
  ];

  for (const script of requiredScripts) {
    it(`has "${script}" script`, () => {
      expect(scripts[script]).toBeDefined();
    });
  }

  it("build uses tsup", () => {
    expect(scripts.build).toBe("tsup");
  });

  it("lint uses oxlint", () => {
    expect(scripts.lint).toBe("oxlint");
  });

  it("format uses oxfmt", () => {
    expect(scripts.format).toBe("oxfmt --write .");
  });

  it("test uses vitest", () => {
    expect(scripts.test).toBe("vitest run");
  });
});

describe("FR-30: Dev tooling configs", () => {
  it("tsconfig.json exists", () => {
    expect(fileExists("tsconfig.json")).toBe(true);
  });

  it("tsconfig extends standards library config", () => {
    const tsconfig = readJson("tsconfig.json") as Record<string, unknown>;
    expect(tsconfig.extends).toBe("@nextnode-solutions/standards/typescript/library");
  });

  it("vitest.config.ts exists", () => {
    expect(fileExists("vitest.config.ts")).toBe(true);
  });

  it("commitlint.config.js exists", () => {
    expect(fileExists("commitlint.config.js")).toBe(true);
  });
});

describe("FR-31: Husky hooks", () => {
  it("commit-msg hook exists", () => {
    expect(fileExists(".husky/commit-msg")).toBe(true);
  });

  it("pre-commit hook exists", () => {
    expect(fileExists(".husky/pre-commit")).toBe(true);
  });

  it("pre-push hook exists", () => {
    expect(fileExists(".husky/pre-push")).toBe(true);
  });
});

describe("Source placeholder", () => {
  it("src/index.ts exists", () => {
    expect(fileExists("src/index.ts")).toBe(true);
  });
});
