import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions } from "../src/scan.ts";

function sign(n: number): -1 | 0 | 1 {
  if (n < 0) return -1;
  if (n > 0) return 1;
  return 0;
}

test("compareVersions: equal stable versions", () => {
  assert.equal(sign(compareVersions("1.0.0", "1.0.0")), 0);
  assert.equal(sign(compareVersions("0.0.0", "0.0.0")), 0);
});

test("compareVersions: major/minor/patch ordering", () => {
  assert.equal(sign(compareVersions("2.0.0", "1.9.9")), 1);
  assert.equal(sign(compareVersions("1.0.0", "2.0.0")), -1);

  assert.equal(sign(compareVersions("1.2.0", "1.1.9")), 1);
  assert.equal(sign(compareVersions("1.1.0", "1.2.0")), -1);

  assert.equal(sign(compareVersions("1.0.1", "1.0.0")), 1);
  assert.equal(sign(compareVersions("1.0.0", "1.0.1")), -1);
});

test("compareVersions: stable > prerelease", () => {
  assert.equal(sign(compareVersions("1.0.0", "1.0.0-beta.1")), 1);
  assert.equal(sign(compareVersions("1.0.0-beta.1", "1.0.0")), -1);
  assert.equal(sign(compareVersions("1.0.0", "1.0.0-rc.1")), 1);
  assert.equal(sign(compareVersions("1.0.0", "1.0.0-alpha")), 1);
});

test("compareVersions: prerelease ordering alpha < beta.1 < beta.2 < rc.1 < 1.0.0", () => {
  const ordered = ["1.0.0-alpha", "1.0.0-beta.1", "1.0.0-beta.2", "1.0.0-rc.1", "1.0.0"];
  for (let i = 0; i < ordered.length - 1; i++) {
    const lo = ordered[i]!;
    const hi = ordered[i + 1]!;
    assert.equal(sign(compareVersions(lo, hi)), -1, `expected ${lo} < ${hi}`);
    assert.equal(sign(compareVersions(hi, lo)), 1, `expected ${hi} > ${lo}`);
  }
});

test("compareVersions: numeric prerelease ids compare numerically", () => {
  // "beta.2" must come after "beta.10" only if numeric IDs compare lexically.
  // Per semver they compare numerically, so beta.2 < beta.10.
  assert.equal(sign(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")), -1);
  assert.equal(sign(compareVersions("1.0.0-beta.10", "1.0.0-beta.2")), 1);
});

test("compareVersions: numeric ids have lower precedence than alphanumeric", () => {
  // Per semver 11.4.3: numeric identifiers always have lower precedence than
  // alphanumeric identifiers.
  assert.equal(sign(compareVersions("1.0.0-1", "1.0.0-alpha")), -1);
  assert.equal(sign(compareVersions("1.0.0-alpha", "1.0.0-1")), 1);
});

test("compareVersions: longer prerelease wins when shared prefix equal", () => {
  // Per semver 11.4.4: a larger set of pre-release fields has higher
  // precedence than a smaller set if all preceding identifiers are equal.
  assert.equal(sign(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")), -1);
  assert.equal(sign(compareVersions("1.0.0-alpha.1", "1.0.0-alpha")), 1);
});

test("compareVersions: build metadata is ignored for ordering", () => {
  assert.equal(sign(compareVersions("1.0.0+build.1", "1.0.0")), 0);
  assert.equal(sign(compareVersions("1.0.0", "1.0.0+build.1")), 0);
  assert.equal(sign(compareVersions("1.0.0+build.1", "1.0.0+build.2")), 0);
  // Build metadata also ignored on prerelease versions.
  assert.equal(sign(compareVersions("1.0.0-beta.1+build.7", "1.0.0-beta.1")), 0);
});

test("compareVersions: build metadata does not alter ordering across versions", () => {
  assert.equal(sign(compareVersions("1.0.1+build.1", "1.0.0+build.9")), 1);
  assert.equal(sign(compareVersions("1.0.0+build.9", "1.0.1+build.1")), -1);
});

test("compareVersions: full semver canonical example chain", () => {
  // From semver.org spec example 11.
  const chain = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
  ];
  for (let i = 0; i < chain.length - 1; i++) {
    assert.equal(sign(compareVersions(chain[i]!, chain[i + 1]!)), -1, `expected ${chain[i]} < ${chain[i + 1]}`);
  }
});

test("compareVersions: non-semver inputs fall back to deterministic compare", () => {
  // The "unknown" sentinel string used by readInstalledPlugins should remain
  // comparable without throwing, and ordering should be self-consistent.
  assert.equal(sign(compareVersions("unknown", "unknown")), 0);
  // Two arbitrary non-semver strings must produce opposite signs when
  // arguments are swapped (anti-symmetry) so sort() stays stable.
  const ab = sign(compareVersions("not-a-version", "totally-bogus"));
  const ba = sign(compareVersions("totally-bogus", "not-a-version"));
  assert.equal(ab, -ba);

  // Dotted-numeric non-semver (e.g. four-part date-like versions) still
  // ordered numerically by the fallback.
  assert.equal(sign(compareVersions("1.2.3.4", "1.2.3.5")), -1);
  assert.equal(sign(compareVersions("1.2.3.5", "1.2.3.4")), 1);
});

test("compareVersions: one-side non-semver still produces deterministic result", () => {
  // Mixed inputs (one valid semver, one not) go through the fallback path.
  // We only require anti-symmetry and equal-self, not a specific ordering.
  const a = "1.0.0";
  const b = "v1.0.0"; // leading "v" makes this non-semver per spec
  const ab = sign(compareVersions(a, b));
  const ba = sign(compareVersions(b, a));
  assert.equal(ab, -ba);
  assert.equal(sign(compareVersions(b, b)), 0);
});

test("compareVersions: transitive across strict semver, partial semver, and prerelease", () => {
  // Reviewer's regression case: in the old dual-algorithm design we had
  //   compareVersions("1.0.0", "1.0")        === 0  (fallback path)
  //   compareVersions("1.0", "1.0.0-alpha")   <  0  (fallback path)
  //   compareVersions("1.0.0", "1.0.0-alpha") >  0  (strict semver path)
  // which violates transitivity (a == b and b < c implies a < c) and made
  // sort() pick inconsistent "highest" entries when inputs mixed shapes.
  // After the fix, the partial "1.0" must parse through the same numeric
  // path as "1.0.0" so all three relate consistently.
  const eq = sign(compareVersions("1.0.0", "1.0"));
  const partialVsPrerelease = sign(compareVersions("1.0", "1.0.0-alpha"));
  const strictVsPrerelease = sign(compareVersions("1.0.0", "1.0.0-alpha"));
  assert.equal(eq, 0, "1.0.0 and 1.0 must compare equal numerically");
  assert.equal(partialVsPrerelease, 1, "1.0 (stable) must outrank 1.0.0-alpha");
  assert.equal(strictVsPrerelease, 1, "1.0.0 (stable) must outrank 1.0.0-alpha");

  // Sort the same set and confirm the result is deterministic and matches
  // semver expectations (prerelease at the bottom, the two stable forms
  // tied at the top). Anti-symmetry of every pair is also checked.
  const items = ["1.0.0", "1.0", "1.0.0-alpha"];
  for (const x of items) {
    for (const y of items) {
      const xy = sign(compareVersions(x, y));
      const yx = sign(compareVersions(y, x));
      assert.equal(xy + yx, 0, `anti-symmetry failed for (${x}, ${y}): xy=${xy}, yx=${yx}`);
    }
  }
  const sorted = [...items].sort((a, b) => compareVersions(a, b));
  assert.equal(sorted[0], "1.0.0-alpha", `prerelease must sort first: ${sorted.join(", ")}`);
  assert.ok(
    (sorted[1] === "1.0.0" && sorted[2] === "1.0") || (sorted[1] === "1.0" && sorted[2] === "1.0.0"),
    `the two stable equivalents must sort after the prerelease: ${sorted.join(", ")}`,
  );

  // Picking the "highest" descending — the operation readInstalledPlugins
  // uses to deduplicate plugin install entries — must never return the
  // prerelease over the stable equivalents.
  const highest = [...items].sort((a, b) => compareVersions(b, a))[0];
  assert.notEqual(highest, "1.0.0-alpha");
});

test("compareVersions: transitive across heterogeneous parsed and unparsable inputs", () => {
  // A wider set that mixes strict semver, partial versions, extended dotted
  // numerics, prereleases, and sentinel strings like "unknown". Verifies the
  // total-order invariant: for every triple (x, y, z), if x <= y and y <= z
  // then x <= z. This is what guarantees Array#sort produces a stable,
  // deterministic result regardless of input shape.
  const items = [
    "2.0.0",
    "1.10.0",
    "1.2.0",
    "1.0.0",
    "1.0",
    "1",
    "1.0.0-rc.1",
    "1.0.0-beta.2",
    "1.0.0-alpha",
    "1.2.3.4",
    "v1.0.0",
    "unknown",
    "totally-bogus",
  ];
  for (const x of items) {
    for (const y of items) {
      const xy = sign(compareVersions(x, y));
      const yx = sign(compareVersions(y, x));
      assert.equal(xy + yx, 0, `anti-symmetry failed for (${x}, ${y}): xy=${xy}, yx=${yx}`);
    }
  }
  for (const x of items) {
    for (const y of items) {
      for (const z of items) {
        const xy = sign(compareVersions(x, y));
        const yz = sign(compareVersions(y, z));
        const xz = sign(compareVersions(x, z));
        if (xy <= 0 && yz <= 0) {
          assert.ok(
            xz <= 0,
            `transitivity failed: ${x} <= ${y} <= ${z} but ${x} > ${z} (xy=${xy}, yz=${yz}, xz=${xz})`,
          );
        }
      }
    }
  }
});
