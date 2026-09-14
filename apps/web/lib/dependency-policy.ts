export interface DependencyAdvisory {
  module_name:string; severity:string; url:string; github_advisory_id?:string;
  findings:{version:string;paths:string[]}[];
}
export const parserExceptions = {
  "GHSA-w3rx-r6r6-pgpr": { version:"1.2.1", expires:"2026-09-27T00:00:00Z", owner:"Mira maintainers", mitigation:"Committed ICNS bounds patch and isolated parser-timeout regression" },
  "GHSA-5p2g-fcmc-qvqq": { version:"1.2.1", expires:"2026-09-27T00:00:00Z", owner:"Mira maintainers", mitigation:"Committed HEIF/JXL box-size patch and isolated parser-timeout regression" },
} as const;
export function reviewedParserException(advisory:DependencyAdvisory, now=Date.now()) {
  const id=advisory.github_advisory_id??advisory.url.split("/").at(-1)??"";
  const exception=parserExceptions[id as keyof typeof parserExceptions];
  return Boolean(exception && now<Date.parse(exception.expires) && advisory.module_name==="image-size" && advisory.severity==="high" && advisory.findings.length && advisory.findings.every(finding=>finding.version===exception.version && finding.paths.length && finding.paths.every(path=>path.startsWith("apps__mobile>")&&path.endsWith(">metro>image-size"))));
}
