import { CodeBlockCommand } from "@/components/code-block-command";
import { ShadscanMark } from "@/components/shadscan-mark";

export default function Page() {
  return (
    <main className="grid flex-1 place-items-center bg-background px-4">
      <div className="flex w-full max-w-2xl flex-col items-center gap-6">
        <ShadscanMark
          accessibleTitle="shadscan"
          className="size-16 text-foreground"
        />
        <div className="w-full">
          <CodeBlockCommand
            bun="bunx shadscan"
            npm="npx shadscan"
            pnpm="pnpm dlx shadscan"
            yarn="yarn dlx shadscan"
          />
        </div>
      </div>
    </main>
  );
}
