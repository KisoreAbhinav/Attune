import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { XrayAnalyzer } from "@/components/xray-analyzer";
import { MriDemo } from "@/components/mri-demo";
import { services } from "@/lib/services";

export function generateStaticParams() {
  return services.map(({ slug }) => ({ service: slug }));
}

export default async function ServicePage({ params }: { params: Promise<{ service: string }> }) {
  const { service: slug } = await params;
  const service = services.find((item) => item.slug === slug);
  if (!service) notFound();

  if (slug === "x-ray") return <XrayAnalyzer />;
  if (slug === "brain-mri" || slug === "knee-mri") return <MriDemo service={slug} />;

  return (
    <main className="mx-auto min-h-screen max-w-3xl space-y-8 px-6 py-16">
      <Button asChild variant="ghost"><Link href="/app">← All services</Link></Button>
      <header className="space-y-4">
        <Badge variant="secondary">Coming soon</Badge>
        <h1 className="text-4xl font-semibold tracking-tight">{service.name}</h1>
        <p className="text-muted-foreground">{service.description}</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Service preview</CardTitle>
          <CardDescription>Model integration is not available yet. This demo does not process images or produce analysis results.</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
