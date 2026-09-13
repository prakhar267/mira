import {describe,expect,it} from "vitest";
import {reviewedParserException,type DependencyAdvisory} from "./dependency-policy";
const finding:DependencyAdvisory={module_name:"image-size",severity:"high",url:"https://github.com/advisories/GHSA-w3rx-r6r6-pgpr",findings:[{version:"1.2.1",paths:["apps__mobile>expo>react-native>@react-native/community-cli-plugin>metro>image-size"]}]};
const now=Date.parse("2026-09-13T00:00:00Z");
describe("time-bounded advisory exceptions",()=>{
  it("permits only the reviewed advisory, version and non-web path",()=>{expect(reviewedParserException(finding,now)).toBe(true);});
  it("rejects a new advisory with the same package name",()=>{expect(reviewedParserException({...finding,url:"https://github.com/advisories/GHSA-new-unreviewed"},now)).toBe(false);});
  it("rejects web paths, unknown versions and expiry",()=>{expect(reviewedParserException({...finding,findings:[{version:"1.2.1",paths:["apps__web>metro>image-size"]}]},now)).toBe(false);expect(reviewedParserException({...finding,findings:[{version:"2.0.2",paths:finding.findings[0]!.paths}]},now)).toBe(false);expect(reviewedParserException(finding,Date.parse("2026-09-28"))).toBe(false);});
});
