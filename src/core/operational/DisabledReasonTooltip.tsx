import { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export interface DisabledReasonTooltipProps {
  reason?: string | null;
  children: ReactNode;
}

/** Wraps children with a tooltip only when reason is truthy. */
export function DisabledReasonTooltip({ reason, children }: DisabledReasonTooltipProps) {
  if (!reason) return <>{children}</>;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        {/* span wrapper so disabled buttons still trigger tooltip */}
        <TooltipTrigger asChild>
          <span className="inline-flex">{children}</span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
