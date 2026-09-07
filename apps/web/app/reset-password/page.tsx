import { AuthRecovery } from "@/components/AuthRecovery";
import { privatePageMetadata } from "@/lib/site";

export const metadata = privatePageMetadata;

export default function ResetPasswordPage() { return <AuthRecovery mode="reset" />; }
