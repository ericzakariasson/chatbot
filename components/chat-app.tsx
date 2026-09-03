"use client"

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import type { InputItem } from "@/lib/xai"
import { ArrowUpIcon, MessageCircleDashedIcon, SquareIcon } from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"
import { readChatStream } from "@/lib/client-stream"
import {
  accumulateAfterTurn,
  buildNextInput,
  type ChatMessage,
  type UsageSummary,
  type WireEvent,
} from "@/lib/protocol"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { Message, MessageContent } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Spinner } from "@/components/ui/spinner"

type Status = "ready" | "submitted" | "streaming"

function newId(): string {
  return crypto.randomUUID()
}

function formatUsage(usage: UsageSummary | null, requestId: string | null): string {
  const parts = ["grok-4.6"]
  if (requestId) parts.push(requestId)
  if (usage) {
    parts.push(`${usage.total_tokens} tokens`)
    if (usage.cost_usd != null) parts.push(`$${usage.cost_usd.toFixed(6)}`)
  }
  return parts.join(" · ")
}

export function ChatApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [status, setStatus] = useState<Status>("ready")
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const priorInputRef = useRef<InputItem[] | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const isBusy = status === "submitted" || status === "streaming"

  function stop() {
    abortRef.current?.abort()
    abortRef.current = null
    setStatus("ready")
  }

  async function send(text: string) {
    const content = text.trim()
    if (!content || isBusy) return

    const userMessage: ChatMessage = { id: newId(), role: "user", content }
    const assistantMessage: ChatMessage = { id: newId(), role: "assistant", content: "" }
    const nextMessages = [...messages, userMessage]
    const input = buildNextInput({
      priorInput: priorInputRef.current,
      messages,
      userContent: content,
    })

    setMessages([...nextMessages, assistantMessage])
    setDraft("")
    setError(null)
    setStatus("submitted")

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
        signal: controller.signal,
      })

      if (!response.ok) {
        let message = `Request failed (${response.status})`
        try {
          const payload = (await response.json()) as WireEvent
          if (payload.type === "error") message = payload.message
        } catch {
          // keep status text
        }
        throw new Error(message)
      }

      let sawDelta = false
      await readChatStream(response, (event) => {
        if (event.type === "delta") {
          sawDelta = true
          setStatus("streaming")
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessage.id
                ? { ...message, content: message.content + event.text }
                : message,
            ),
          )
        } else if (event.type === "done") {
          if (event.usage) setUsage(event.usage)
          if (event.requestId !== undefined) setRequestId(event.requestId ?? null)
          priorInputRef.current = accumulateAfterTurn(input, event.toInput)
        } else if (event.type === "error") {
          setError(event.message)
        }
      })

      if (!sawDelta) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessage.id && message.content.length === 0
              ? { ...message, content: "No text was returned." }
              : message,
          ),
        )
      }
    } catch (err) {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : "Chat request failed"
      setError(message)
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setStatus("ready")
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void send(draft)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void send(draft)
    }
  }

  const showThinking = status === "submitted"

  return (
    <MessageScrollerProvider autoScroll>
      <div className="flex h-dvh min-h-0 flex-col bg-background">
        <header className="shrink-0 border-b bg-background">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h1 className="text-sm font-medium">Grok</h1>
              <p className="text-xs text-muted-foreground">
                Streaming chat.
              </p>
            </div>
            <ThemeToggle />
          </div>
        </header>

        <div className="min-h-0 flex-1">
          {messages.length === 0 ? (
            <Empty className="mx-auto h-full max-w-3xl px-4">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageCircleDashedIcon />
                </EmptyMedia>
                <EmptyTitle>Ask Grok…</EmptyTitle>
                <EmptyDescription>
                  Messages stream as they arrive.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent
                  aria-busy={isBusy}
                  className="mx-auto w-full max-w-3xl px-4 py-6"
                >
                  {messages.map((message) => (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={message.role === "user"}
                    >
                      <Message align={message.role === "user" ? "end" : "start"}>
                        <MessageContent>
                          {message.role === "assistant" &&
                          message.content.length === 0 &&
                          isBusy ? null : (
                            <Bubble
                              align={message.role === "user" ? "end" : "start"}
                              variant={message.role === "user" ? "default" : "secondary"}
                            >
                              <BubbleContent>{message.content}</BubbleContent>
                            </Bubble>
                          )}
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  ))}
                  {showThinking ? (
                    <MessageScrollerItem scrollAnchor={false}>
                      <Marker role="status">
                        <MarkerIcon>
                          <Spinner />
                        </MarkerIcon>
                        <MarkerContent className="shimmer">Thinking…</MarkerContent>
                      </Marker>
                    </MessageScrollerItem>
                  ) : null}
                  {error ? (
                    <MessageScrollerItem scrollAnchor={false}>
                      <Marker role="status">
                        <MarkerContent>{error}</MarkerContent>
                      </Marker>
                    </MessageScrollerItem>
                  ) : null}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          )}
        </div>

        <footer className="shrink-0 border-t bg-background">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-1.5 px-4 py-3">
            <form onSubmit={onSubmit}>
              <InputGroup
                data-chat-composer
                className="h-auto min-h-16 rounded-xl"
              >
                <InputGroupTextarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Ask Grok…"
                  disabled={false}
                  rows={1}
                  aria-label="Message"
                  className="min-h-16 px-3 py-3"
                />
                <InputGroupAddon align="block-end" className="justify-end">
                  {isBusy ? (
                    <InputGroupButton
                      type="button"
                      variant="default"
                      size="icon-sm"
                      className="rounded-full"
                      aria-label="Stop"
                      onClick={stop}
                    >
                      <SquareIcon />
                    </InputGroupButton>
                  ) : (
                    <InputGroupButton
                      type="submit"
                      variant="default"
                      size="icon-sm"
                      className="rounded-full"
                      aria-label="Send"
                      disabled={draft.trim().length === 0}
                    >
                      <ArrowUpIcon />
                    </InputGroupButton>
                  )}
                </InputGroupAddon>
              </InputGroup>
            </form>
            <p className="text-center text-[11px] leading-none text-muted-foreground">
              {formatUsage(usage, requestId)}
            </p>
          </div>
        </footer>
      </div>
    </MessageScrollerProvider>
  )
}
