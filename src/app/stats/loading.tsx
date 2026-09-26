import { Panel, PanelBody, Skeleton } from '@/components/ui/primitives';

/** Shown while a career's statistics are put together, on the first visit and after a long break. */
export default function StatsLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-4" aria-busy="true" aria-label="Loading Career Statistics">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <Panel>
        <PanelBody className="flex flex-wrap gap-2.5">
          {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-9 w-32" />)}
        </PanelBody>
      </Panel>
      <Skeleton className="h-8 w-96 max-w-full" />
      <Panel>
        <PanelBody>
          <div className="grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-3">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-2.5 w-28" />
                <Skeleton className="h-9 w-24" />
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => (
          <Panel key={index}>
            <PanelBody className="space-y-3">
              {Array.from({ length: 4 }, (_, row) => <Skeleton key={row} className="h-6 w-full" />)}
            </PanelBody>
          </Panel>
        ))}
      </div>
    </div>
  );
}
