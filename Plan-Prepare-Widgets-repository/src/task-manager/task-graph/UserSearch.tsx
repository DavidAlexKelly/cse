import React, { useState, useMemo, useCallback } from "react";
import { searchUsers } from "./users.js";
import type { User } from "./users.js";

interface UserSearchProps {
  label: string;
  selectedUser: string;
  onSelect: (userName: string) => void;
}

export const UserSearch: React.FC<UserSearchProps> = ({ label, selectedUser, onSelect }) => {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const results = useMemo(() => searchUsers(query), [query]);

  const handleSelect = useCallback(
    (user: User) => {
      onSelect(user.name);
      setQuery("");
      setIsOpen(false);
    },
    [onSelect],
  );

  return (
    <div style={{ position: "relative" }}>
      {/* Label */}
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#6a7292",
          marginBottom: 4,
        }}
      >
        {label}
      </div>

      {/* Current selection + search trigger */}
      <div
        role="button"
        tabIndex={0}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 9px",
          background: "#0e1120",
          border: "1px solid #2f3860",
          borderRadius: 2,
          cursor: "pointer",
        }}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setIsOpen(!isOpen)}
      >
        <span style={{ fontSize: 12, color: selectedUser ? "#e6eaf8" : "#6a7292", flex: 1 }}>
          {selectedUser || "Select user..."}
        </span>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="#98a1c0">
          <path d="M8 2a4 4 0 100 8 4 4 0 000-8zM1 8a7 7 0 1112.45 4.34l2.6 2.6a.75.75 0 01-1.06 1.06l-2.6-2.6A7 7 0 011 8z" />
        </svg>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            background: "#141828",
            border: "1px solid #2f3860",
            borderRadius: 3,
            boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
            zIndex: 200,
            maxHeight: 240,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Search input */}
          <div style={{ padding: "6px 8px", borderBottom: "1px solid #232a45" }}>
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search personnel..."
              style={{
                width: "100%",
                background: "#0e1120",
                border: "1px solid #2f3860",
                borderRadius: 2,
                color: "#e6eaf8",
                fontSize: 12,
                padding: "4px 8px",
                outline: "none",
                fontFamily: "inherit",
              }}
            />
          </div>

          {/* Results */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {results.length === 0 ? (
              <div style={{ padding: "12px 8px", fontSize: 11, color: "#6a7292", textAlign: "center" }}>
                No personnel found
              </div>
            ) : (
              results.map((user) => (
                <div
                  key={user.id}
                  role="option"
                  aria-selected={selectedUser === user.name}
                  tabIndex={0}
                  onClick={() => handleSelect(user)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && handleSelect(user)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    cursor: "pointer",
                    borderBottom: "1px solid #1a1f36",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = "#1a1f36";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = "transparent";
                  }}
                >
                  {/* Avatar */}
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: user.color,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 9,
                      fontWeight: 700,
                      color: "#fff",
                      flexShrink: 0,
                    }}
                  >
                    {user.initials}
                  </div>
                  {/* Details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#e6eaf8" }}>
                      {user.name}
                    </div>
                    <div style={{ fontSize: 10, color: "#6a7292" }}>
                      {user.role} · {user.directorate} · {user.nation}
                    </div>
                  </div>
                  {/* Selected indicator */}
                  {selectedUser === user.name && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="#6c5ce7">
                      <path d="M6.5 12.5l-4-4 1.5-1.5 2.5 2.5 6-6 1.5 1.5z" />
                    </svg>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
