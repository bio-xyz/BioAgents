import { useState } from 'preact/hooks';
import { Button, IconButton } from './ui';

export function Sidebar({ sessions, currentSessionId, onSessionSelect, onNewSession, onDeleteSession, isMobileOpen, onMobileClose }) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobileOpen ? 'open' : ''}`}>
      <div className="sidebar-header">
        {!isCollapsed && (
          <>
            <div className="sidebar-branding">
              <div className="sidebar-logo">
                BIOAGENTS
              </div>
              <div className="sidebar-header-actions">
                {/* Close button for mobile */}
                <IconButton
                  icon="close"
                  onClick={onMobileClose}
                  title="Close menu"
                  variant="ghost"
                  className="mobile-close-btn"
                />
                {/* Collapse button for desktop */}
                <IconButton
                  icon="chevronLeft"
                  onClick={() => setIsCollapsed(!isCollapsed)}
                  title="Collapse sidebar"
                  variant="ghost"
                  className="toggle-sidebar-btn"
                />
              </div>
            </div>
            <Button
              variant="secondary"
              icon="plus"
              onClick={onNewSession}
              className="new-session-btn"
            >
              New Chat
            </Button>
            <Button
              variant="ghost"
              icon="search"
              title="Search chats"
              className="sidebar-search-btn"
            >
              <span>Search chats</span>
              <kbd className="kbd">⌘K</kbd>
            </Button>
          </>
        )}
        {isCollapsed && (
          <IconButton
            icon="chevronRight"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title="Expand sidebar"
            variant="ghost"
            className="toggle-sidebar-btn"
            style={{ margin: '0 auto' }}
          />
        )}
      </div>

      {!isCollapsed && (
        <>
          <div className="sessions-list">
            <div className="sessions-list-header">RECENT CHATS</div>
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`session-item ${session.id === currentSessionId ? 'active' : ''}`}
                onClick={() => onSessionSelect(session.id)}
              >
                <div className="session-info">
                  <span className="session-title">{session.title || 'New conversation'}</span>
                </div>
                <IconButton
                  icon="trash"
                  size={14}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(session.id);
                  }}
                  title="Delete session"
                  variant="ghost"
                  className="delete-session-btn"
                />
              </div>
            ))}
          </div>

          <div className="sidebar-footer">
            <Button
              variant="ghost"
              icon="logout"
              title="Log out"
              className="sidebar-logout-btn"
            >
              Log Out
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
