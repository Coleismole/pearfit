// A row of options where one is picked, like the "Tight / Great / Loose" choice.
interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  label: string; // read by screen readers
  options: readonly Option<T>[];
  value: T | null;
  onChange(value: T): void;
  small?: boolean;
}

export function Segmented<T extends string>({ label, options, value, onChange, small }: Props<T>) {
  return (
    <div className={small ? "segmented segmented--small" : "segmented"} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
