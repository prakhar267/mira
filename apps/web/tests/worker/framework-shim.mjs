// Only the framework scheduler/router is replaced. Production route functions,
// auth, provider adapters and MiraStore SQL run unchanged inside workerd.
import { AsyncLocalStorage } from "node:async_hooks";
const responseScope = new AsyncLocalStorage();
export function withResponseScope(context, work) { return responseScope.run(context, work); }
export function after(work) {
  const context = responseScope.getStore();
  if (!context) throw new Error("No response scope in isolated route test");
  context.waitUntil(Promise.resolve().then(work));
}
const syntheticHandler = {fetch:()=>new Response("Use the explicit synthetic route harness",{status:404})};
export default syntheticHandler;
