import { Skeleton } from "@/components/ui/skeleton";

const CATEGORY_SKELETON_IDS = [
  "foundation",
  "interaction",
  "states",
  "accessibility",
  "forms",
  "production-polish",
] as const;
const FINDING_SKELETON_IDS = ["primary", "secondary", "tertiary"] as const;

function ScanLoading() {
  return (
    <div
      aria-hidden="true"
      className="grid min-h-80 gap-8 border-border border-t pt-8 lg:grid-cols-[minmax(0,18rem)_1fr]"
    >
      <div className="flex flex-col gap-5">
        <Skeleton className="h-20 w-40" />
        <div className="flex flex-col gap-3">
          {CATEGORY_SKELETON_IDS.map((categoryId) => (
            <div className="flex flex-col gap-2" key={categoryId}>
              <div className="flex justify-between gap-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-12" />
              </div>
              <Skeleton className="h-2 w-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-6 lg:border-border lg:border-l lg:pl-8">
        <Skeleton className="h-8 w-44" />
        {FINDING_SKELETON_IDS.map((findingId) => (
          <div
            className="flex flex-col gap-3 border-border border-t pt-5"
            key={findingId}
          >
            <Skeleton className="h-5 w-3/5" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

export { ScanLoading };
