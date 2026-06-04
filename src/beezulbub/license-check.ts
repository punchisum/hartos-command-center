/**
 * src/beezulbub/license-check.ts
 *
 * License risk classification for Beezulbub.
 *
 * Note: This is operational risk classification only.
 * Not legal advice. Verify with your own legal review.
 */

export type LicenseRisk = "safe" | "review" | "risky" | "unknown";

export interface LicenseCheckResult {
  license: string | null;
  risk: LicenseRisk;
  canDevour: boolean;
  notes: string;
}

// Licenses considered safe for internal use / copying patterns
const SAFE_LICENSES = new Set([
  "MIT",
  "MIT License",
  "Apache-2.0",
  "Apache 2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "CC0-1.0",
  "Unlicense",
  "0BSD",
]);

// Licenses that need review before use
const REVIEW_LICENSES = new Set([
  "LGPL-2.0",
  "LGPL-2.1",
  "LGPL-3.0",
  "LGPL-2.0-only",
  "LGPL-2.1-only",
  "LGPL-3.0-only",
  "MPL-2.0",
  "EPL-1.0",
  "EPL-2.0",
  "CDDL-1.0",
]);

// Licenses that are risky for copying / commercial use
const RISKY_LICENSES = new Set([
  "GPL-2.0",
  "GPL-3.0",
  "GPL-2.0-only",
  "GPL-3.0-only",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "CC-BY-SA-4.0",
  "CC-BY-NC-4.0",
  "SSPL-1.0",
  "BUSL-1.1",
]);

function normalizeLicense(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function checkLicense(licenseText: string | null | undefined): LicenseCheckResult {
  if (!licenseText) {
    return {
      license: null,
      risk: "unknown",
      canDevour: false,
      notes:
        "No license found. Default copyright applies — cannot devour without explicit permission.",
    };
  }

  const normalized = normalizeLicense(licenseText);

  // Check exact matches first
  if (SAFE_LICENSES.has(normalized)) {
    return {
      license: normalized,
      risk: "safe",
      canDevour: true,
      notes: `${normalized} — permissive license, safe to absorb patterns and adapt.`,
    };
  }

  if (REVIEW_LICENSES.has(normalized)) {
    return {
      license: normalized,
      risk: "review",
      canDevour: false,
      notes: `${normalized} — LGPL/MPL variant. Needs review for linking/modification rules.`,
    };
  }

  if (RISKY_LICENSES.has(normalized)) {
    return {
      license: normalized,
      risk: "risky",
      canDevour: false,
      notes:
        `${normalized} — Copyleft license. Cannot devour code directly. ` +
        `May reference patterns only. Avoid AGPL entirely in SaaS context.`,
    };
  }

  // Fuzzy matching for common variations
  const upper = normalized.toUpperCase();
  if (upper.includes("MIT")) {
    return { license: normalized, risk: "safe", canDevour: true, notes: "MIT variant — safe." };
  }
  if (upper.includes("APACHE")) {
    return {
      license: normalized,
      risk: "safe",
      canDevour: true,
      notes: "Apache variant — safe with attribution.",
    };
  }
  if (upper.includes("AGPL") || upper.includes("GPL")) {
    return {
      license: normalized,
      risk: "risky",
      canDevour: false,
      notes: "GPL/AGPL variant — risky. Reference only.",
    };
  }
  if (upper.includes("BSD")) {
    return { license: normalized, risk: "safe", canDevour: true, notes: "BSD variant — safe." };
  }
  if (upper.includes("PROPRIETARY") || upper.includes("ALL RIGHTS")) {
    return {
      license: normalized,
      risk: "risky",
      canDevour: false,
      notes: "Proprietary license — cannot absorb.",
    };
  }

  // Custom / unknown
  return {
    license: normalized,
    risk: "review",
    canDevour: false,
    notes: `Custom or unrecognised license: "${normalized}". Manual review required.`,
  };
}

/** Extract license from package.json license field or LICENSE file content */
export function extractLicenseFromPackageJson(pkg: Record<string, unknown>): string | null {
  if (typeof pkg["license"] === "string") return pkg["license"];
  if (typeof pkg["licence"] === "string") return pkg["licence"];
  return null;
}

/** Guess license from LICENSE file content */
export function guesslicenseFromContent(content: string): string | null {
  const upper = content.toUpperCase().slice(0, 500);
  if (upper.includes("MIT LICENSE") || upper.includes("PERMISSION IS HEREBY GRANTED")) return "MIT";
  if (upper.includes("APACHE LICENSE") && upper.includes("VERSION 2")) return "Apache-2.0";
  if (upper.includes("GNU GENERAL PUBLIC LICENSE") && upper.includes("VERSION 3")) return "GPL-3.0";
  if (upper.includes("GNU GENERAL PUBLIC LICENSE") && upper.includes("VERSION 2")) return "GPL-2.0";
  if (upper.includes("GNU AFFERO GENERAL PUBLIC LICENSE")) return "AGPL-3.0";
  if (upper.includes("GNU LESSER GENERAL PUBLIC LICENSE")) return "LGPL-2.1";
  if (upper.includes("BSD 2-CLAUSE") || upper.includes("SIMPLIFIED BSD")) return "BSD-2-Clause";
  if (upper.includes("BSD 3-CLAUSE") || upper.includes("NEW BSD")) return "BSD-3-Clause";
  if (upper.includes("ISC LICENSE") || upper.includes("ISC PERMISSIVE")) return "ISC";
  if (upper.includes("MOZILLA PUBLIC LICENSE")) return "MPL-2.0";
  return null;
}
