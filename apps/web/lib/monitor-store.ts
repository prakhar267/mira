import {cloudStore,storeAction} from "./cloud-store";
export const monitorStore={
  ...cloudStore,
  recentMetrics:async()=>(await storeAction<{metrics:Record<string,unknown>[]}>({action:"recentMetrics"})).metrics,
  capacity:async()=>(await storeAction<{capacity:{key:string;count:number}[]}>({action:"capacity"})).capacity,
};
