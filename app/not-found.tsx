import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid flex-1 place-items-center px-5">
      <div className="w-full max-w-md border bg-card p-6">
        <p className="font-mono text-muted-foreground text-sm">404</p>
        <h1 className="mt-3 font-heading font-medium text-3xl">
          Missing route
        </h1>
        <p className="mt-3 text-muted-foreground leading-7">
          shadscan checked the route table. This one is not in it.
        </p>
        <Button asChild className="mt-5">
          <Link href="/">Back to audit</Link>
        </Button>
      </div>
    </main>
  );
}
