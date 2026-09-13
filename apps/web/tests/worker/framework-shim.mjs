// Only the framework scheduler/router is replaced. Production route functions,
// auth, provider adapters and MiraStore SQL run unchanged inside workerd.
export function after() { throw new Error("No Next response scope in isolated route test"); }
const syntheticHandler = {fetch:()=>new Response("Use the explicit synthetic route harness",{status:404})};
export default syntheticHandler;
