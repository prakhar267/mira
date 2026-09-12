"use client";
import { useEffect,useState } from "react";
import { analyticsConsentKey } from "@/lib/analytics";
export function AnalyticsConsent() {
  const [enabled,setEnabled]=useState(false);
  useEffect(()=>{try {setEnabled(localStorage.getItem(analyticsConsentKey)==="yes");}catch{}},[]);
  return <label className="toggle-line"><span><strong>Anonymous product analytics</strong><small>Optional usage counts and timing only. Never messages, audio, identity or camera data. Do Not Track is respected.</small></span><input type="checkbox" checked={enabled} onChange={e=>{const next=e.target.checked;setEnabled(next);try{localStorage.setItem(analyticsConsentKey,next?"yes":"no");}catch{setEnabled(false);}}}/></label>;
}
