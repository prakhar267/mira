import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

export function Button({ className = "", children, ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return (
    <button className={`ui-button ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function VisuallyHidden({ children }: PropsWithChildren) {
  return <span className="visually-hidden">{children}</span>;
}
