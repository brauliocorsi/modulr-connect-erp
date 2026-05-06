import { ActivitiesPanel } from "@/core/activities/ActivitiesPanel";
import { Chatter } from "@/core/chatter/Chatter";

export function RecordSidebar({ recordType, recordId }: { recordType: string; recordId: string }) {
  return (
    <div className="space-y-4">
      <ActivitiesPanel recordType={recordType} recordId={recordId} />
      <Chatter recordType={recordType} recordId={recordId} />
    </div>
  );
}
