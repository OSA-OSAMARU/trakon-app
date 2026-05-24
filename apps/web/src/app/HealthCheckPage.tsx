import { useQuery } from '@tanstack/react-query';
import type { Health } from '@trakon/shared';

async function fetchHealth(): Promise<Health> {
  const res = await fetch('/api/v1/healthz');
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return (await res.json()) as Health;
}

export function HealthCheckPage() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
  });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-foreground">
      <h1 className="text-4xl font-semibold tracking-tight">TRAKON</h1>
      <p className="text-muted-foreground">Keep the ball moving.</p>

      <section className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-3 text-lg font-medium">Health check</h2>
        {isLoading && <p className="text-sm text-muted-foreground">Pinging API…</p>}
        {error && (
          <p className="text-sm text-destructive">
            API error: {error instanceof Error ? error.message : 'unknown'}
          </p>
        )}
        {data && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">status</dt>
            <dd className="font-mono">{data.status}</dd>
            <dt className="text-muted-foreground">uptime</dt>
            <dd className="font-mono">{data.uptime.toFixed(2)}s</dd>
            <dt className="text-muted-foreground">timestamp</dt>
            <dd className="font-mono">{data.timestamp}</dd>
          </dl>
        )}
      </section>
    </main>
  );
}
