import Link from 'next/link';
import { Plus } from 'lucide-react';
import { CareerHeader } from '@/components/dashboard/career-header';
import { CurrentStint } from '@/components/dashboard/current-stint';
import { StrategistPanel } from '@/components/dashboard/strategist-panel';
import { AnnualFuelTank, WeeklyFuelTank } from '@/components/dashboard/fuel-tanks';
import {
  CareerSnapshot, ChallengesPanel, RecentUnlocks, SeasonPassPanel,
} from '@/components/dashboard/panels';
import { Button } from '@/components/ui/controls';
import { getDashboard } from '@/lib/server/dashboard';
import { ensureCareer } from '@/lib/server/bootstrap';
import { requireUserId } from '@/lib/auth/session';
import { backlogFraming } from '@/lib/copy/tone';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const data = await getDashboard(userId);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* -- Career header ------------------------------------------------- */}
      <CareerHeader data={data.header} />

      {/* -- Current stint and the strategist ------------------------------- */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <CurrentStint stint={data.stint} />
        <StrategistPanel recommendations={data.recommendations} />
      </div>

      {/* -- Fuel tanks ----------------------------------------------------- */}
      {data.budget ? (
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_1.4fr]">
          <WeeklyFuelTank budget={data.budget} />
          <AnnualFuelTank budget={data.budget} />
        </div>
      ) : null}

      {/* -- Season pass and challenges ------------------------------------- */}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_1.4fr]">
        <SeasonPassPanel pass={data.seasonPass} closure={data.seasonPassClosure} />
        <ChallengesPanel challenges={data.challenges} />
      </div>

      {/* -- Recent unlocks and the career snapshot ------------------------- */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <RecentUnlocks unlocks={data.unlocks} />
        <CareerSnapshot snapshot={data.snapshot} />
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 px-1 pb-2 pt-1">
        <p className="text-xs text-ink-faint">{backlogFraming(data.unwatchedCount)}</p>
        <Link href="/races/new">
          <Button variant="subtle" size="sm"><Plus size={13} /> Add a race</Button>
        </Link>
      </footer>
    </div>
  );
}
