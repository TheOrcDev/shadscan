import { Spinner } from "@/components/ui/spinner";
import { ScanLoading } from "./scan-loading";

function QueuedScanStatus({ status }: { status: "queued" | "running" }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 font-medium text-sm">
        <Spinner aria-hidden="true" />
        {status === "queued" ? "Scan queued" : "Scanning repository"}
      </div>
      <ScanLoading />
    </div>
  );
}

export { QueuedScanStatus };
