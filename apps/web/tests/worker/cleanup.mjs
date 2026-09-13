import {env} from "cloudflare:workers";
import {reset,runInDurableObject,evictAllDurableObjects,listDurableObjectIds} from "cloudflare:test";

/** Test binding only. Drain/clear SQLite before eviction: generic reset() alone
 * can crash the current local workerd, or retain evicted SQLite fixture data. */
export async function cleanupWorkerState(){
  if(env.MIRA_LOCAL_TEST!=="synthetic-only")throw new Error("Refusing to clear non-synthetic storage");
  for(const id of await listDurableObjectIds(env.MIRA_STORE))await runInDurableObject(env.MIRA_STORE.get(id),async(instance,ctx)=>{
    instance.__releaseLegacy?.(null);
    if(instance.__realLegacy)instance.env.LUMA_ACCOUNTS=instance.__realLegacy;
    await ctx.storage.deleteAlarm();
    for(const row of ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").toArray())ctx.storage.sql.exec(`DELETE FROM "${row.name.replaceAll('"','""')}"`);
  });
  await evictAllDurableObjects();
  await reset();
}
