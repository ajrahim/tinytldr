import type { ReactNode } from "react";

export function SiteLink(props: {
  href: string;
  onNavigate: (path: string) => void;
  children: ReactNode;
  current?: boolean;
  className?: string;
}) {
  return (
    <a
      href={props.href}
      className={props.className}
      aria-current={props.current ? "page" : undefined}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        props.onNavigate(props.href);
      }}
    >
      {props.children}
    </a>
  );
}
