import { AdminDashboard } from "@/components/AdminDashboard";
import { privatePageMetadata } from "@/lib/site";

export const metadata = privatePageMetadata;

export default function AdminPage() { return <AdminDashboard />; }
