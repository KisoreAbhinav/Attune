import { Link } from "next-view-transitions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { services } from "@/lib/services";
import styles from "./page.module.css";

export default function AppPage() {
  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-10 px-6 py-16">
      <Button asChild variant="ghost"><Link href="/">← Attune</Link></Button>
      <header className={`space-y-4 ${styles.intro}`}>
        <Badge variant="secondary">Demo</Badge>
        <h1 className="text-4xl font-semibold tracking-tight">Choose a service</h1>
        <p className="text-muted-foreground">A starting point for exploring medical image analysis.</p>
      </header>
      <section aria-label="Services" className={`grid gap-6 md:grid-cols-3 ${styles.services}`}>
        {services.map((service) => (
          <Card key={service.slug} className={styles.card}>
            <CardHeader>
              <CardTitle>{service.name}</CardTitle>
              <CardDescription>{service.description}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button asChild variant="outline"><Link href={`/app/${service.slug}`}>Explore {service.name} →</Link></Button>
            </CardFooter>
          </Card>
        ))}
      </section>
    </main>
  );
}
