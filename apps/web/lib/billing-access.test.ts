import {describe,expect,it} from "vitest";
import {hasPaidAccess} from "./billing-access";
describe("verified subscription access",()=>{
  const now=Date.parse("2026-09-12T00:00:00Z"),future="2026-10-12T00:00:00Z";
  it("keeps a period-end cancellation until the paid-through date",()=>{expect(hasPaidAccess({status:"cancelled",cancelAtPeriodEnd:true,renewsAt:future},now)).toBe(true);expect(hasPaidAccess({status:"cancelled",cancelAtPeriodEnd:true,renewsAt:future},Date.parse(future))).toBe(false);});
  it("revokes immediate cancellations, failures and holds",()=>{for(const status of ["on_hold","failed","expired","pending","cancelled"])expect(hasPaidAccess({status,renewsAt:future},now)).toBe(false);});
  it("fails closed on malformed cancellation dates and never trusts a redirect",()=>{expect(hasPaidAccess({status:"cancelled",cancelAtPeriodEnd:true,renewsAt:"invalid"},now)).toBe(false);expect(hasPaidAccess({status:"success"},now)).toBe(false);expect(hasPaidAccess(null,now)).toBe(false);});
});
