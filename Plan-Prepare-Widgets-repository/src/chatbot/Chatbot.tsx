/* eslint-disable jsx-a11y/no-autofocus */
import { Icon } from "@blueprintjs/core";
import { useFoundryWidgetContext } from "@osdk/widget.client-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../client.js";
import { useScenarioIdFromObjectSet } from "../shared/hooks/useScenarioIdFromParam.js";
import { ScenarioGate } from "../shared/components/ScenarioGate.js";
import "../shared/styling/index.css";
import "./chatbot.css";
import type ChatbotConfig from "./chatbot.config.js";

// ── Constants ──────────────────────────────────────────────────────────────

const AGENT_RID = "ri.aip-agents..agent.2ec32cc8-58c9-46ab-88e3-a61f4830d778";

const SUGGESTIONS = [
  "What is the current planning status of this scenario?",
  "Summarise the phases and their objectives.",
  "Which tasks are still pending or in review?",
  "Give me a strategic context overview.",
];

// ── Types ──────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: Date;
}

// ── Context ────────────────────────────────────────────────────────────────

const useWidgetContext =
  useFoundryWidgetContext.withTypes<typeof ChatbotConfig>();

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function uniqueId(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return `${Date.now()}-${arr[0].toString(36)}`;
}

// ── Component ──────────────────────────────────────────────────────────────

const ChatbotBody: React.FC<{ scenarioId: string }> = ({
  scenarioId,
}) => {
  const { emitEvent } = useWidgetContext();

  // ── State ─────────────────────────────────────────────────────────────

  const [sessionRid, setSessionRid] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Session init ───────────────────────────────────────────────────────

  const createSession = useCallback(async () => {
    setSessionLoading(true);
    setSessionError(null);
    setMessages([]);
    try {
      const response = await fetch(
        `${window.location.origin}/api/v2/aipAgents/agents/${encodeURIComponent(
          AGENT_RID
        )}/sessions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${await getToken()}`,
          },
          body: JSON.stringify({
            title: `NXG Ops — ${scenarioId ?? "General"}`,
          }),
        }
      );
      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.status}`);
      }
      const data = (await response.json()) as { rid: string };
      setSessionRid(data.rid);
    } catch (e) {
      setSessionError(String(e));
    } finally {
      setSessionLoading(false);
    }
  }, [scenarioId]);

  useEffect(() => {
    void createSession();
  }, [createSession]);

  // ── Auto-scroll ────────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  // ── Auto-resize textarea ───────────────────────────────────────────────

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [inputValue]);

  // ── Token helper ───────────────────────────────────────────────────────
  // The OSDK client uses createFoundryWidgetTokenProvider which surfaces
  // the user token at runtime via the widget runtime bridge.

  async function getToken(): Promise<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenProvider = (client as any)._tokenProvider;
      if (tokenProvider && typeof tokenProvider.getToken === "function") {
        return (await tokenProvider.getToken()) as string;
      }
    } catch {
      // fallback below
    }
    return "";
  }

  // ── Send message ───────────────────────────────────────────────────────

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !sessionRid || isSending) return;

      setSendError(null);
      setInputValue("");

      const userMsg: ChatMessage = {
        id: uniqueId(),
        role: "user",
        text: trimmed,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsSending(true);

      try {
        const token = await getToken();
        const response = await fetch(
          `${
            window.location.origin
          }/api/v2/aipAgents/agents/${encodeURIComponent(
            AGENT_RID
          )}/sessions/${encodeURIComponent(sessionRid)}/streamingContinue`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: token ? `Bearer ${token}` : "",
              Accept: "text/event-stream",
            },
            body: JSON.stringify({
              userInput: { message: trimmed },
            }),
          }
        );

        if (!response.ok) {
          throw new Error(`Agent error: ${response.status}`);
        }

        // Stream SSE response
        const agentMsgId = uniqueId();
        setMessages((prev) => [
          ...prev,
          {
            id: agentMsgId,
            role: "agent",
            text: "",
            timestamp: new Date(),
          },
        ]);

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) throw new Error("No response body");

        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data:")) {
              const dataStr = line.slice(5).trim();
              if (!dataStr || dataStr === "[DONE]") continue;
              try {
                const parsed = JSON.parse(dataStr) as {
                  type?: string;
                  delta?: { text?: string };
                  text?: string;
                };
                const chunk = parsed.delta?.text ?? parsed.text ?? "";
                if (chunk) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === agentMsgId ? { ...m, text: m.text + chunk } : m
                    )
                  );
                }
              } catch {
                // non-JSON line, skip
              }
            }
          }
        }
      } catch (e) {
        setSendError(String(e));
        // Remove the empty agent message bubble if it was added
        setMessages((prev) =>
          prev.filter((m) => m.role !== "agent" || m.text.length > 0)
        );
      } finally {
        setIsSending(false);
      }
    },
    [sessionRid, isSending]
  );

  // ── Key handler ────────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void sendMessage(inputValue);
      }
    },
    [sendMessage, inputValue]
  );

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="cb-root bp5-dark">
      {/* ── Header ── */}
      <div className="cb-header">
        <div className="cb-header__icon">
          <Icon icon="chat" size={14} />
        </div>
        <div className="cb-header__info">
          <div className="cb-header__title">[NXG] Operations Chatbot</div>
          <div className="cb-header__subtitle">
            {scenarioId ? `Scenario: ${scenarioId}` : "AI Operations Assistant"}
          </div>
        </div>
        <div className="cb-header__actions">
          <button
            type="button"
            className="cb-header__btn"
            onClick={() => void createSession()}
            title="Start a new conversation"
            disabled={sessionLoading}
          >
            <Icon icon="refresh" size={11} /> New chat
          </button>
          <button
            type="button"
            className="cb-header__btn cb-header__btn--close"
            onClick={() => emitEvent("onClose", { parameterUpdates: {} })}
            title="Close chatbot"
          >
            <Icon icon="cross" size={11} />
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      {sessionLoading ? (
        <div className="cb-init">
          <div className="cb-spinner" />
          <span>Connecting to AI assistant…</span>
        </div>
      ) : sessionError ? (
        <div className="cb-messages">
          <div className="cb-error">
            <Icon icon="warning-sign" size={13} />
            Failed to start session: {sessionError}
          </div>
          <button
            type="button"
            className="cb-suggestion-btn"
            style={{ marginTop: 8 }}
            onClick={() => void createSession()}
          >
            Retry connection
          </button>
        </div>
      ) : (
        <div className="cb-messages">
          {messages.length === 0 ? (
            /* Welcome / empty state */
            <div className="cb-welcome">
              <div className="cb-welcome__icon">
                <Icon icon="chat" size={28} />
              </div>
              <div className="cb-welcome__title">NXG Operations Assistant</div>
              <div className="cb-welcome__body">
                Ask me anything about this exercise scenario — planning status,
                phases, tasks, training objectives, or strategic context.
              </div>
              <div className="cb-welcome__suggestions">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="cb-suggestion-btn"
                    onClick={() => void sendMessage(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`cb-message cb-message--${msg.role}`}
                >
                  <div className="cb-message__avatar">
                    {msg.role === "agent" ? (
                      <Icon icon="chat" size={12} />
                    ) : (
                      <Icon icon="person" size={12} />
                    )}
                  </div>
                  <div>
                    <div className="cb-message__bubble">{msg.text}</div>
                    <div className="cb-message__time">
                      {formatTime(msg.timestamp)}
                    </div>
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {isSending && (
                <div className="cb-typing">
                  <div className="cb-typing__avatar">
                    <Icon icon="chat" size={12} />
                  </div>
                  <div className="cb-typing__bubble">
                    <div className="cb-typing__dot" />
                    <div className="cb-typing__dot" />
                    <div className="cb-typing__dot" />
                  </div>
                </div>
              )}

              {/* Send error */}
              {sendError && (
                <div className="cb-error">
                  <Icon icon="warning-sign" size={13} />
                  {sendError}
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* ── Input area ── */}
      {!sessionLoading && !sessionError && (
        <div className="cb-input-area">
          <div className="cb-input-row">
            <textarea
              ref={textareaRef}
              className="cb-textarea"
              placeholder="Ask the operations assistant…"
              value={inputValue}
              rows={1}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSending}
              autoFocus
            />
            <button
              type="button"
              className="cb-send-btn"
              onClick={() => void sendMessage(inputValue)}
              disabled={isSending || !inputValue.trim()}
              title="Send message (Enter)"
            >
              <Icon icon="send-message" size={14} />
            </button>
          </div>
          <div className="cb-input-hint">
            Press Enter to send · Shift+Enter for new line
          </div>
        </div>
      )}
    </div>
  );
};

// ── Widget entry point ─────────────────────────────────────────────────────
// Resolves the bound scenario before mounting the body, so the body always
// has a real scenario to work with and never silently falls back to a
// default exercise.

export const Chatbot: React.FC = () => {
  const { parameters } = useWidgetContext();
  const binding = useScenarioIdFromObjectSet(
    parameters.values.scenario?.objectSet
  );
  return (
    <ScenarioGate binding={binding}>
      {(scenarioId) => <ChatbotBody scenarioId={scenarioId} />}
    </ScenarioGate>
  );
};
