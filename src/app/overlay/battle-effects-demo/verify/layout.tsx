export default function BattleEffectsVerifyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full w-full" suppressHydrationWarning>
      {children}
    </div>
  );
}
