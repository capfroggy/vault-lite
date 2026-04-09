import {
  ArrowPathIcon,
  CheckIcon,
  CloudArrowUpIcon,
  EyeIcon,
  EyeSlashIcon,
  LockClosedIcon,
  SparklesIcon,
  StarIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarSolidIcon } from "@heroicons/react/24/solid";

export function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="metric-ring rounded-[28px] border border-[rgba(19,17,13,0.08)] bg-white/74 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7c6349]">
        {label}
      </p>
      <p className="mt-3 font-display text-2xl font-semibold tracking-tight text-[#17120d]">
        {value}
      </p>
      <p className="mt-2 text-sm leading-6 text-[#5f5044]">{helper}</p>
    </div>
  );
}

export function DarkChecklistItem({ text }: { text: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/6 px-4 py-4 text-sm text-[#f3e8d7]">
      <div className="flex items-start gap-3">
        <LockClosedIcon className="mt-0.5 size-4 shrink-0 text-[#dbb27c]" />
        <span>{text}</span>
      </div>
    </div>
  );
}

export function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl bg-white/6 px-4 py-4">
      <p className="text-xs uppercase tracking-[0.2em] text-[#cab39a]">{label}</p>
      <p className="mt-2 text-sm font-semibold text-[#f7efe4]">{value}</p>
    </div>
  );
}

export function RecipeToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-sm font-semibold ${
        active
          ? "border-[rgba(15,125,123,0.24)] bg-[rgba(15,125,123,0.08)] text-[#0f5f5d]"
          : "border-[rgba(19,17,13,0.12)] bg-white text-[#47392c] hover:bg-[rgba(19,17,13,0.04)]"
      }`}
    >
      {label}
    </button>
  );
}

export function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-[#47392c]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="rounded-3xl border border-[rgba(19,17,13,0.12)] bg-white px-4 py-3 text-sm text-[#17120d] placeholder:text-[#8a7a68]"
      />
    </label>
  );
}

export function TextAreaField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-[#47392c]">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={5}
        className="resize-none rounded-3xl border border-[rgba(19,17,13,0.12)] bg-white px-4 py-3 text-sm text-[#17120d] placeholder:text-[#8a7a68]"
      />
    </label>
  );
}

export function SecureInput({
  label,
  value,
  placeholder,
  visible,
  actionLabel,
  actionVariant = "neutral",
  onAction,
  onChange,
  onToggleVisibility,
}: {
  label: string;
  value: string;
  placeholder: string;
  visible: boolean;
  actionLabel?: string;
  actionVariant?: "neutral" | "primary";
  onAction?: () => void;
  onChange: (value: string) => void;
  onToggleVisibility: () => void;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-[#47392c]">{label}</span>
      <div className="grid gap-3 rounded-3xl border border-[rgba(19,17,13,0.12)] bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <input
            type={visible ? "text" : "password"}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            className="w-full bg-transparent text-sm text-[#17120d] placeholder:text-[#8a7a68] focus:outline-none"
          />
          <button
            type="button"
            onClick={onToggleVisibility}
            className="text-[#7c6349] hover:text-[#17120d]"
            aria-label={visible ? "Hide secret" : "Show secret"}
          >
            {visible ? <EyeSlashIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </button>
        </div>
        {onAction && actionLabel ? (
          <button
            type="button"
            onClick={onAction}
            className={`flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
              actionVariant === "primary"
                ? "bg-[#17120d] text-white hover:-translate-y-0.5 hover:bg-[#2d241b]"
                : "border border-[rgba(19,17,13,0.12)] text-[#17120d] hover:bg-[rgba(19,17,13,0.04)]"
            }`}
          >
            {actionVariant === "primary" ? (
              <CheckIcon className="size-4" />
            ) : (
              <ArrowPathIcon className="size-4" />
            )}
            {actionLabel}
          </button>
        ) : null}
      </div>
    </label>
  );
}

export function FileDropRow({
  fileName,
  onChange,
}: {
  fileName: string | null;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-3xl border border-dashed border-[rgba(19,17,13,0.16)] bg-white/70 px-4 py-4 text-sm text-[#5f5044] hover:border-[rgba(19,17,13,0.28)]">
      <span className="flex min-w-0 items-center gap-3">
        <CloudArrowUpIcon className="size-4 shrink-0" />
        <span className="truncate">{fileName ?? "Choose a backup JSON file"}</span>
      </span>
      <input
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      <span className="rounded-full bg-[rgba(19,17,13,0.08)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-[#5f5044]">
        Browse
      </span>
    </label>
  );
}

export function ScoreCard({
  label,
  score,
  toneLabel,
  feedback,
}: {
  label: string;
  score: number;
  toneLabel: string;
  feedback: string[];
}) {
  const toneClass =
    score <= 1 ? "text-[#8f3824]" : score === 2 ? "text-[#8f5a16]" : "text-[#175941]";

  return (
    <div className="rounded-3xl border border-[rgba(19,17,13,0.08)] bg-white/72 p-4">
      <div className="flex items-center justify-between text-sm font-semibold text-[#47392c]">
        <span>{label}</span>
        <span className={toneClass}>{toneLabel}</span>
      </div>
      <div className="mt-3 h-2 rounded-full bg-[rgba(19,17,13,0.08)]">
        <div
          className="h-2 rounded-full"
          style={{
            width: `${(score + 1) * 20}%`,
            backgroundColor:
              score <= 1 ? "var(--danger)" : score === 2 ? "var(--accent)" : "var(--success)",
          }}
        />
      </div>
      <div className="mt-3 grid gap-2 text-sm text-[#5f5044]">
        {feedback.map((item) => (
          <div key={item} className="flex items-start gap-2">
            <SparklesIcon className="mt-0.5 size-4 text-[#db8f34]" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FavoriteToggle({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-[rgba(19,17,13,0.12)] p-3 hover:bg-[rgba(19,17,13,0.04)]"
      aria-label="Toggle favorite"
    >
      {active ? (
        <StarSolidIcon className="size-4 text-[#db8f34]" />
      ) : (
        <StarIcon className="size-4 text-[#7c6349]" />
      )}
    </button>
  );
}
