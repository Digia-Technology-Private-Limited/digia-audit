import { AuditProgress } from "../../../components/AuditProgress";

export default async function AuditPage({ params }: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await params;
  return <AuditProgress auditId={auditId} />;
}
