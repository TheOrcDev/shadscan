const compareCodeUnits = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
};

export { compareCodeUnits };
