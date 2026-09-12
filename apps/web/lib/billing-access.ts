/** A verified end-of-period cancellation keeps access until the paid period
 * ends. Missing or malformed period-end dates fail closed. */
export function hasPaidAccess(record: {status?:string;renewsAt?:string;cancelAtPeriodEnd?:boolean} | null, now=Date.now()) {
  if(!record)return false;
  const future=typeof record.renewsAt==="string" && Number.isFinite(Date.parse(record.renewsAt)) && Date.parse(record.renewsAt)>now;
  if(record.status==="cancelled")return record.cancelAtPeriodEnd===true && future;
  return record.status==="active" && (!record.renewsAt || future);
}
