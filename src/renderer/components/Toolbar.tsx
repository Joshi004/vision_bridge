interface ToolbarProps {
  children: React.ReactNode;
  className?: string;
}

export default function Toolbar({ children, className }: ToolbarProps) {
  return (
    <div className={`toolbar${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}

export function ToolbarDivider() {
  return <div className="toolbar__divider" aria-hidden="true" />;
}

export function ToolbarSpacer() {
  return <div className="toolbar__spacer" aria-hidden="true" />;
}
