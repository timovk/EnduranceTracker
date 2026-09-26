import { Panel, PanelBody, Skeleton } from '@/components/ui/primitives';

/** Shown while a chapter is put together from the history. */
export default function ChapterLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-4" aria-busy="true" aria-label="Loading the chapter">
      <div className="space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      {Array.from({ length: 3 }, (_, panel) => (
        <Panel key={panel}>
          <PanelBody>
            <div className="grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-4">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="space-y-2">
                  <Skeleton className="h-2.5 w-24" />
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </div>
          </PanelBody>
        </Panel>
      ))}
      <Panel>
        <PanelBody className="space-y-3">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-9 w-full" />)}
        </PanelBody>
      </Panel>
    </div>
  );
}
