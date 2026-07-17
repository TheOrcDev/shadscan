import { CodeBlockCommand } from "@/components/code-block-command";

export default function Page() {
  return (
    <main className="grid min-h-svh place-items-center bg-background px-4 [&>div]:w-full [&>div]:max-w-2xl">
      <CodeBlockCommand
        bun="bunx shadscan"
        npm="npx shadscan"
        pnpm="pnpm dlx shadscan"
        yarn="yarn dlx shadscan"
      />
    </main>
  );
}
