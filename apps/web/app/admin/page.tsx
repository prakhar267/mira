import { OperationsDashboard } from "@/components/OperationsDashboard";
import { privatePageMetadata } from "@/lib/site";

export const metadata = privatePageMetadata;

export default function AdminPage() { return <OperationsDashboard />; }
