import { Skeleton } from '@/components/ui/primitives';

/** Shown while a year's Wrapped is put together: one card, and the controls under it. */
export default function WrappedLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4" aria-busy="true" aria-label="Loading Endurance Wrapped">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="panel-raised flex min-h-[26rem] flex-col justify-between gap-6 p-6 sm:min-h-[22rem] sm:p-10">
        <div className="space-y-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-12 w-56" />
        </div>
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-2 w-40" />
        <Skeleton className="h-8 w-20" />
      </div>
    </div>
  );
}
