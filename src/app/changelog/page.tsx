import { PageHeader } from '@/components/layout/page-header';
import { ReleaseNotes } from '@/components/layout/release-notes';
import { Badge, Panel, PanelBody } from '@/components/ui/primitives';
import { requireUserId } from '@/lib/auth/session';
import { CHANGELOG } from '@/lib/changelog';
import { APP_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Update log' };

export default async function ChangelogPage() {
  await requireUserId();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        eyebrow={`Version ${APP_VERSION}`}
        title="Update log"
        description="What changed in each version, newest first."
      />

      {CHANGELOG.map((entry) => (
        <Panel key={entry.version}>
          <PanelBody className="relative">
            {entry.version === APP_VERSION ? (
              <Badge tone="accent" className="absolute right-4 top-4">This version</Badge>
            ) : null}
            <ReleaseNotes entry={entry} />
          </PanelBody>
        </Panel>
      ))}
    </div>
  );
}
