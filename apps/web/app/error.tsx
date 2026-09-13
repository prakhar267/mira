"use client";
import Link from "next/link";
export default function ApplicationError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="app-loader"><h1>This page couldn’t open.</h1><p role="alert">Try again, or return home. Any unsaved changes in this page may need to be re-entered.</p><button type="button" className="button button--primary" onClick={reset}>Try again</button><Link href="/">Return home</Link></main>;
}
