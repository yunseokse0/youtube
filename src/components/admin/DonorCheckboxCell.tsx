"use client";

type DonorCheckboxCellProps = {
  donorId?: string;
  isAll?: boolean;
  selected: boolean;
  onToggle: (donorId?: string, isAll?: boolean) => void;
  label?: string;
};

export default function DonorCheckboxCell({
  donorId,
  isAll = false,
  selected,
  onToggle,
  label,
}: DonorCheckboxCellProps) {
  const id = `donor-chk-${isAll ? "all" : donorId}`;

  return (
    <label
      htmlFor={id}
      className="flex items-center justify-center cursor-pointer select-none"
    >
      <input
        id={id}
        type="checkbox"
        className="rounded border-white/20 bg-neutral-900"
        style={{
          width: 18,
          height: 18,
          accentColor: "#d4af37",
        }}
        checked={selected}
        onChange={() => onToggle(isAll ? undefined : donorId, isAll)}
        aria-label={label}
      />
    </label>
  );
}
