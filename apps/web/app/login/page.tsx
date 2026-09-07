import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { LoginForm } from "@/components/LoginForm";
import { privatePageMetadata } from "@/lib/site";

export const metadata = privatePageMetadata;

export default function LoginPage() {
  return <main className="auth-page"><section className="auth-panel"><Link href="/"><BrandMark /></Link><span className="eyebrow">Welcome back</span><h1>Continue the conversation.</h1><p>Sign in with the account you created during companion setup.</p><LoginForm /><Link href="/signup">Need an account? Start setup</Link></section><aside className="auth-visual" aria-label="Mira in the sunny companion loft" /></main>;
}
