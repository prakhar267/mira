import { redirect } from "next/navigation";
import { privatePageMetadata } from "@/lib/site";

export const metadata = privatePageMetadata;

export default function SignupPage() {
  redirect("/app?onboarding=1");
}
