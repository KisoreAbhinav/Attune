import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center gap-6 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Attune</h1>
      <p className="text-muted-foreground">Explore the image analysis demo.</p>
      <Button asChild><Link href="/app">Try Demo</Link></Button>
    </main>
  );
}
