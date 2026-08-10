// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: The page evaluator stays closure-free so Playwright can serialize it safely.
/// <reference lib="dom" />

interface BrowserMeasurementLimits {
  maxCulprits: number;
  maxDescriptorLength: number;
  maxElements: number;
}

interface BrowserOverflowCulprit {
  depth: number;
  descriptor: string;
  left: number;
  order: number;
  overflowPx: number;
  right: number;
}

interface BrowserOverflowMeasurement {
  clientWidth: number;
  culprits: BrowserOverflowCulprit[];
  forcedScrollbar: boolean;
  omittedCulprits: number;
  scrollWidth: number;
}

type StabilityVector = [
  clientWidth: number,
  rootScrollWidth: number,
  bodyScrollWidth: number,
];

/**
 * Runs inside the audited page. Keep every helper inside this function because
 * Playwright serializes the callback without its module scope.
 */
const measureDocumentOverflow = ({
  maxCulprits,
  maxDescriptorLength,
  maxElements,
}: BrowserMeasurementLimits): BrowserOverflowMeasurement => {
  const root = document.documentElement;
  const body = document.body;
  const clientWidth = root.clientWidth;
  const scrollWidth = Math.max(root.scrollWidth, body?.scrollWidth ?? 0);
  const rootOverflowX = getComputedStyle(root).overflowX;
  const bodyOverflowX = body ? getComputedStyle(body).overflowX : null;
  const forcedScrollbar =
    rootOverflowX === "scroll" || bodyOverflowX === "scroll";

  if (!((scrollWidth > clientWidth || forcedScrollbar) && body)) {
    return {
      clientWidth,
      culprits: [],
      forcedScrollbar,
      omittedCulprits: 0,
      scrollWidth,
    };
  }

  const containmentValues = new Set(["auto", "clip", "hidden", "scroll"]);
  const maximumCoordinate = 10_000_000;
  const maximumTokenLength = 48;
  const maximumAncestryLevels = 4;

  const boundNumber = (value: number): number => {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(-maximumCoordinate, Math.min(maximumCoordinate, value));
  };

  const sanitizeToken = (value: string): string =>
    value
      .normalize("NFKC")
      .replace(/\p{Cc}/gu, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maximumTokenLength);

  const getParentElement = (element: Element): Element | null => {
    if (element.parentElement) {
      return element.parentElement;
    }

    const rootNode = element.getRootNode();
    return rootNode instanceof ShadowRoot ? rootNode.host : null;
  };

  const formatDirectDescriptor = (element: Element): string | null => {
    const dataSlot = sanitizeToken(element.getAttribute("data-slot") ?? "");
    if (dataSlot) {
      return `[data-slot="${dataSlot}"]`;
    }

    const id = sanitizeToken(element.id);
    return id ? `#${id}` : null;
  };

  const formatElementSegment = (element: Element): string => {
    const directDescriptor = formatDirectDescriptor(element);
    if (directDescriptor) {
      return directDescriptor;
    }

    const tagName = sanitizeToken(element.localName.toLowerCase()) || "element";
    const classNames: string[] = [];

    for (const rawClassName of Array.from(element.classList)) {
      const className = sanitizeToken(rawClassName);
      if (className && !classNames.includes(className)) {
        classNames.push(className);
      }
      if (classNames.length === 2) {
        break;
      }
    }

    const parent = getParentElement(element);
    const sameTagSiblings = parent
      ? Array.from(parent.children).filter(
          (sibling) => sibling.localName === element.localName
        )
      : [];
    const siblingIndex = sameTagSiblings.indexOf(element);
    const nthOfType =
      sameTagSiblings.length > 1 && siblingIndex >= 0
        ? `:nth-of-type(${siblingIndex + 1})`
        : "";

    return `${tagName}${classNames.map((name) => `.${name}`).join("")}${nthOfType}`;
  };

  const formatDescriptor = (element: Element): string => {
    const directDescriptor = formatDirectDescriptor(element);
    if (directDescriptor) {
      return directDescriptor.slice(0, maxDescriptorLength);
    }

    const ancestry: string[] = [];
    let currentElement: Element | null = element;

    while (
      currentElement &&
      currentElement !== body &&
      currentElement !== root &&
      ancestry.length < maximumAncestryLevels
    ) {
      ancestry.unshift(formatElementSegment(currentElement));
      const parent = getParentElement(currentElement);
      if (parent) {
        const parentDescriptor = formatDirectDescriptor(parent);
        if (parentDescriptor) {
          if (ancestry.length < maximumAncestryLevels) {
            ancestry.unshift(parentDescriptor);
          }
          break;
        }
      }
      currentElement = parent;
    }

    return ancestry.join(" > ").slice(0, maxDescriptorLength);
  };

  const getTraversalChildren = (
    element: Element,
    maximumChildren: number
  ): Element[] => {
    const children: Element[] = [];
    const appendChildren = (collection: HTMLCollection): void => {
      let index = 0;
      while (index < collection.length && children.length < maximumChildren) {
        const child = collection.item(index);
        if (child) {
          children.push(child);
        }
        index += 1;
      }
    };

    if (element.shadowRoot) {
      appendChildren(element.shadowRoot.children);
    }
    appendChildren(element.children);
    return children;
  };

  const documentLeft = 0;
  const documentRight = clientWidth;
  const culpritCandidates: Array<
    Omit<BrowserOverflowCulprit, "descriptor"> & { element: Element }
  > = [];
  const stack: Array<{
    containedByAncestor: boolean;
    depth: number;
    element: Element;
  }> = [{ containedByAncestor: false, depth: 0, element: body }];
  let order = 0;

  while (stack.length > 0 && order < maxElements) {
    const entry = stack.pop();
    if (!entry) {
      break;
    }

    const { containedByAncestor, depth, element } = entry;
    const traversalOrder = order;
    order += 1;
    const style = getComputedStyle(element);
    const elementContainsDescendantOverflow =
      element !== body &&
      element !== root &&
      (style.position === "fixed" || containmentValues.has(style.overflowX));

    const remainingTraversalCapacity = Math.max(
      0,
      maxElements - order - stack.length
    );
    const children = getTraversalChildren(element, remainingTraversalCapacity);
    for (
      let childIndex = children.length - 1;
      childIndex >= 0;
      childIndex -= 1
    ) {
      const child = children[childIndex];
      if (child) {
        stack.push({
          containedByAncestor:
            containedByAncestor || elementContainsDescendantOverflow,
          depth: depth + 1,
          element: child,
        });
      }
    }

    if (element === body || element === root) {
      continue;
    }

    if (style.position === "fixed" || containedByAncestor) {
      continue;
    }

    const rectangle = element.getBoundingClientRect();
    if (rectangle.width <= 0 || rectangle.height <= 0) {
      continue;
    }

    const left = rectangle.left + window.scrollX;
    const right = rectangle.right + window.scrollX;
    const edgeOverflow = Math.max(
      0,
      documentLeft - left,
      right - documentRight
    );
    const internalOverflow =
      style.overflowX === "visible"
        ? Math.max(0, element.scrollWidth - element.clientWidth)
        : 0;
    const overflowPx = Math.max(edgeOverflow, internalOverflow);

    if (overflowPx <= 0) {
      continue;
    }

    culpritCandidates.push({
      depth,
      element,
      left: boundNumber(left),
      order: traversalOrder,
      overflowPx: boundNumber(overflowPx),
      right: boundNumber(right),
    });
  }

  culpritCandidates.sort(
    (first, second) =>
      second.overflowPx - first.overflowPx ||
      second.depth - first.depth ||
      first.order - second.order
  );
  const culprits = culpritCandidates
    .slice(0, maxCulprits)
    .map(({ element, ...culprit }) => ({
      ...culprit,
      descriptor: formatDescriptor(element),
    }));

  return {
    clientWidth,
    culprits,
    forcedScrollbar,
    omittedCulprits: Math.max(0, culpritCandidates.length - maxCulprits),
    scrollWidth,
  };
};

const readDocumentWidthVector = (): StabilityVector => {
  const root = document.documentElement;
  return [root.clientWidth, root.scrollWidth, document.body?.scrollWidth ?? 0];
};

const waitForTwoAnimationFrames = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });

export type {
  BrowserMeasurementLimits,
  BrowserOverflowCulprit,
  BrowserOverflowMeasurement,
  StabilityVector,
};
export {
  measureDocumentOverflow,
  readDocumentWidthVector,
  waitForTwoAnimationFrames,
};
