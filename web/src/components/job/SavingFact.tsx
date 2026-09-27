export function SavingFact({ pct, projected }: { pct: number; projected?: boolean }) {
  const rounded = Math.round(pct);
  if (rounded >= 0) {
    return (
      <span className="job-saving">
        {projected ? "about " : ""}
        {rounded}% smaller
      </span>
    );
  }
  return (
    <span className="job-saving negative">
      {projected ? "about " : ""}
      {Math.abs(rounded)}% bigger
    </span>
  );
}
