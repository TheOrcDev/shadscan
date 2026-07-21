const SPONSOR_CONTACT_EMAIL = "sponsors@shadscan.com";

type SponsorTierId = "diamond" | "gold" | "platinum" | "silver";

interface SponsorTier {
  checkoutHref: string;
  gridClassName: string;
  id: SponsorTierId;
  name: string;
  slotClassName: string;
  slotIds: readonly string[];
}

const checkoutUrls = {
  diamond: process.env.CREEM_SPONSOR_DIAMOND_CHECKOUT_URL,
  gold: process.env.CREEM_SPONSOR_GOLD_CHECKOUT_URL,
  platinum: process.env.CREEM_SPONSOR_PLATINUM_CHECKOUT_URL,
  silver: process.env.CREEM_SPONSOR_SILVER_CHECKOUT_URL,
} satisfies Record<SponsorTierId, string | undefined>;

const buildContactHref = (tierName: string): string => {
  const subject = encodeURIComponent(`shadscan ${tierName} sponsorship`);
  return `mailto:${SPONSOR_CONTACT_EMAIL}?subject=${subject}`;
};

const getCheckoutHref = (id: SponsorTierId, name: string): string => {
  const contactHref = buildContactHref(name);
  const configuredUrl = checkoutUrls[id]?.trim();

  if (!configuredUrl) {
    return contactHref;
  }

  try {
    const checkoutUrl = new URL(configuredUrl);
    return checkoutUrl.protocol === "https:" ? checkoutUrl.href : contactHref;
  } catch {
    return contactHref;
  }
};

const createTier = ({
  gridClassName,
  id,
  name,
  slotClassName,
  slots,
}: Omit<SponsorTier, "checkoutHref" | "slotIds"> & {
  slots: number;
}): SponsorTier => ({
  checkoutHref: getCheckoutHref(id, name),
  gridClassName,
  id,
  name,
  slotClassName,
  slotIds: Array.from({ length: slots }, (_, index) => `${id}-${index + 1}`),
});

const SPONSOR_TIERS = [
  createTier({
    gridClassName: "grid-cols-1 sm:grid-cols-2",
    id: "diamond",
    name: "Diamond",
    slotClassName: "min-h-32",
    slots: 4,
  }),
  createTier({
    gridClassName: "grid-cols-2 sm:grid-cols-3",
    id: "platinum",
    name: "Platinum",
    slotClassName: "min-h-24",
    slots: 6,
  }),
  createTier({
    gridClassName: "grid-cols-2 sm:grid-cols-4",
    id: "gold",
    name: "Gold",
    slotClassName: "min-h-20",
    slots: 8,
  }),
  createTier({
    gridClassName: "grid-cols-3 sm:grid-cols-6",
    id: "silver",
    name: "Silver",
    slotClassName: "min-h-12",
    slots: 12,
  }),
] as const;

export type { SponsorTier };
export { SPONSOR_TIERS };
