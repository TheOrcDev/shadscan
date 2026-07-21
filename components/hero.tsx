import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HeroButton {
  text: string;
  url: string;
}

interface HeroButtons {
  primary?: HeroButton;
  secondary?: HeroButton;
}

interface HeroProps {
  buttons?: HeroButtons;
  className?: string;
  description: string;
  heading: string;
  logo?: ReactNode;
  media?: ReactNode;
}

const Hero = ({
  logo,
  heading,
  description,
  buttons,
  media,
  className,
}: HeroProps) => (
  <section className={cn("py-32", className)}>
    <div className="overflow-hidden">
      <div className="container mx-auto">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col items-center gap-6 text-center">
            {logo && (
              <div className="flex items-center justify-center">{logo}</div>
            )}
            <h1 className="max-w-xl text-pretty font-semibold text-4xl tracking-tight md:text-5xl lg:max-w-3xl lg:text-6xl">
              {heading}
            </h1>
            <p className="mx-auto max-w-3xl text-balance text-muted-foreground lg:text-xl">
              {description}
            </p>
            {(buttons?.primary || buttons?.secondary) && (
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
                {buttons?.primary && (
                  <Button asChild className="w-full sm:w-auto" size="lg">
                    <a href={buttons.primary.url}>
                      {buttons.primary.text}
                      <ArrowRightIcon data-icon="inline-end" />
                    </a>
                  </Button>
                )}
                {buttons?.secondary && (
                  <Button
                    asChild
                    className="w-full sm:w-auto"
                    size="lg"
                    variant="outline"
                  >
                    <a href={buttons.secondary.url}>{buttons.secondary.text}</a>
                  </Button>
                )}
              </div>
            )}
          </div>
          {media && <div className="mt-16 w-full">{media}</div>}
        </div>
      </div>
    </div>
  </section>
);

export { Hero };
