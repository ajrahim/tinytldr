import { useState } from "react";
import { Check, Copy } from "lucide-react";

export interface CodeSnippetBoxProps {
  readonly title: string;
  readonly badge?: string;
  readonly code: string;
  readonly compact?: boolean;
}

export function CodeSnippetBox({ title, badge, code, compact = false }: CodeSnippetBoxProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const handleCopy = async () => {
    try {
      setCopyError(null);
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      setCopied(false);
      setCopyError(
        `Could not copy. Select the code and copy it manually. ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <div className="ui-surface overflow-hidden rounded-xl">
      <div className="ui-hairline-b flex items-center justify-between gap-2 px-3.5 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 break-all text-xs font-medium">{title}</span>
          {badge ? (
            <span
              className="rounded px-1.5 py-0.5 font-mono text-[10px]"
              style={{
                backgroundColor: "var(--ui-surface-subtle)",
                color: "var(--ui-text-secondary)",
              }}
            >
              {badge}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="ui-surface-subtle inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition hover:opacity-80"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre
        className={`overflow-x-auto font-mono text-xs leading-relaxed ${compact ? "p-3" : "p-3.5"}`}
        style={{ color: "var(--ui-text-secondary)" }}
      >
        <code>{code}</code>
      </pre>
      {copyError && (
        <p role="alert" className="notice-error px-3.5 pb-3 text-xs">
          {copyError}
        </p>
      )}
    </div>
  );
}
