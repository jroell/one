/** What a package's license field says, split into a custom license file or a plain SPDX line. */
export type LicenseLabel =
  | { readonly kind: "custom"; readonly file: string }
  | { readonly kind: "spdx"; readonly text: string };

const SEE_LICENSE = /^\(?\s*SEE LICEN[CS]E IN\s+(.+?)\s*\)?$/i;

/**
 * "SEE LICENSE IN README.md" names a file, not a license, and "(Apache-2.0 AND BSD-3-Clause)"
 * wraps a list in parentheses and shouts its conjunction. Both read as ordinary text instead.
 */
export function licenseLabel(license: string): LicenseLabel {
  const trimmed = license.trim();
  const custom = SEE_LICENSE.exec(trimmed);
  if (custom?.[1]) return { kind: "custom", file: custom[1].replace(/\.(md|txt)$/i, "") };
  const unwrapped = /^\((.*)\)$/.exec(trimmed)?.[1] ?? trimmed;
  return {
    kind: "spdx",
    text: unwrapped.replace(/\s+AND\s+/g, " + ").replace(/\s+OR\s+/g, " or "),
  };
}
