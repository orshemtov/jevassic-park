import JevassicGame from '@/components/JevassicGame';
import { isAdminMode, watchConfig } from '@/lib/jev/config';

export const dynamic = 'force-dynamic';

export default function Home() {
  const { decisionIntervalMs, population } = watchConfig();
  return <JevassicGame adminMode={isAdminMode()} decisionIntervalMs={decisionIntervalMs} spectatorPopulation={population} />;
}
