import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const files = JSON.parse(
  await readFile(resolve(root, "tests/feature-coverage-scope.json"), "utf8"),
);
const report = JSON.parse(
  await readFile(
    resolve(root, "test-results/coverage-features/coverage-summary.json"),
    "utf8",
  ),
);
for (const file of files) {
  const coverage = report[resolve(root, file)];
  if (!coverage || !coverage.lines.total)
    throw Error(`Missing executable source from coverage report: ${file}`);
  for (const metric of ["statements", "branches", "functions", "lines"]) {
    if (coverage[metric].pct < 95)
      throw Error(
        `${file}: ${metric} coverage ${coverage[metric].pct}% is below 95%`,
      );
  }
}
console.log(
  `Coverage verified: all ${files.length} feature files present; each exceeds the 95% minimum for statements, branches, functions and lines.`,
);
