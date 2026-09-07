import { AuthRecovery } from "@/components/AuthRecovery";
import { privatePageMetadata } from "@/lib/site";

export const metadata = privatePageMetadata;

export default function ForgotPasswordPage() { return <AuthRecovery mode="forgot" />; }
