import { Search } from 'lucide-react'

const isMac = window.api.platform === 'darwin'

interface TitleBarProps {
  onSearchClick: () => void;
}

export default function TitleBar({ onSearchClick }: TitleBarProps) {
  return (
    <div className={`titlebar${isMac ? ' titlebar--mac' : ' titlebar--win'}`}>
      <div className="titlebar__brand">
        <span className="titlebar__brand-icon">V</span>
        <span className="titlebar__brand-name">VisionBridge</span>
      </div>
      <button
        className="titlebar__search"
        type="button"
        onClick={onSearchClick}
        tabIndex={0}
        aria-label="Open command palette"
      >
        <Search size={12} />
        <span>Search leads...</span>
        <kbd>{isMac ? '⌘K' : 'Ctrl+K'}</kbd>
      </button>
    </div>
  )
}
