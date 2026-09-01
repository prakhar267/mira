import { redirect } from "next/navigation";

export default function SignupPage() {
  redirect("/app?onboarding=1");
}
