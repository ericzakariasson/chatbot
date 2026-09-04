"use client"

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import type { InputItem } from "@/lib/xai"
import {
  ArrowUpIcon,
  BinocularsIcon,
  CaretRightIcon,
  ChatCircleDotsIcon,
  GlobeIcon,
  ImageIcon,
  PaperclipIcon,
  PlusIcon,
  SquareIcon,
} from "@phosphor-icons/react"

import { ThemeToggle } from "@/components/theme-toggle"
import { readChatStream } from "@/lib/client-stream"
import {
  accumulateAfterTurn,
  buildNextInput,
  type ChatMessage,
  type WireEvent,
} from "@/lib/protocol"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
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
import { Marker, MarkerContent } from "@/components/ui/marker"
import { Message, MessageContent } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"

type Status = "ready" | "submitted" | "streaming"

function ThinkingTrace({
  text,
  active,
}: {
  text: string
  active: boolean
}) {
  const [open, setOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !bodyRef.current) return
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [text, open])

  const label = active ? "Thinking" : "Thought"

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      <button
        type="button"
        className="group/thought flex w-fit items-center gap-1 text-sm text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={active ? "shimmer" : undefined}>{label}</span>
        <CaretRightIcon
          className={
            open
              ? "rotate-90 opacity-0 transition-all group-hover/thought:opacity-100"
              : "opacity-0 transition-all group-hover/thought:opacity-100"
          }
        />
      </button>
      {open ? (
        <div
          ref={bodyRef}
          className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground"
        >
          {text || (active ? "…" : "")}
        </div>
      ) : null}
    </div>
  )
}

function newId(): string {
  return crypto.randomUUID()
}

export function ChatApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [status, setStatus] = useState<Status>("ready")
  const [error, setError] = useState<string | null>(null)
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
        if (event.type === "thinking") {
          setStatus("streaming")
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessage.id
                ? { ...message, thinking: `${message.thinking ?? ""}${event.text}` }
                : message,
            ),
          )
        } else if (event.type === "delta") {
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

  return (
    <MessageScrollerProvider autoScroll>
      <div className="flex h-dvh min-h-0 flex-col bg-background">
        <header className="shrink-0 bg-background">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
            <h1 className="text-sm font-medium">Grok</h1>
            <ThemeToggle />
          </div>
        </header>

        <div className="relative min-h-0 flex-1">
          {messages.length === 0 ? (
            <Empty className="mx-auto h-full max-w-3xl px-4">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ChatCircleDotsIcon />
                </EmptyMedia>
                <EmptyTitle>Ask Grok…</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent
                  aria-busy={isBusy}
                  className="mx-auto w-full max-w-3xl px-4 pt-6 pb-40"
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
                          (message.thinking ||
                            (message.content.length === 0 && isBusy)) ? (
                            <ThinkingTrace
                              text={message.thinking ?? ""}
                              active={
                                isBusy &&
                                message.content.length === 0 &&
                                message.id === messages[messages.length - 1]?.id
                              }
                            />
                          ) : null}
                          {message.content.length > 0 ? (
                            <Bubble
                              align={message.role === "user" ? "end" : "start"}
                              variant={message.role === "user" ? "secondary" : "ghost"}
                            >
                              <BubbleContent className="rounded-3xl">{message.content}</BubbleContent>
                            </Bubble>
                          ) : null}
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  ))}
                  {error ? (
                    <MessageScrollerItem scrollAnchor={false}>
                      <Marker role="status">
                        <MarkerContent>{error}</MarkerContent>
                      </Marker>
                    </MessageScrollerItem>
                  ) : null}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton className="data-[direction=end]:bottom-40" />
            </MessageScroller>
          )}

          <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background from-55% to-transparent pt-10">
            <div className="pointer-events-auto mx-auto flex w-full max-w-3xl flex-col gap-1.5 px-4 pb-3">
            <form onSubmit={onSubmit}>
              <InputGroup
                data-chat-composer
                className="h-auto overflow-hidden rounded-2xl bg-background shadow-sm"
              >
                <InputGroupTextarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Ask Grok…"
                  disabled={false}
                  rows={1}
                  aria-label="Message"
                  className="px-4"
                />
                <InputGroupAddon align="block-end" className="px-2.5 pb-2.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <InputGroupButton
                        aria-label="Add files"
                        type="button"
                        size="icon-sm"
                        variant="secondary"
                        className="rounded-full"
                      >
                        <PlusIcon />
                      </InputGroupButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      side="top"
                      className="w-44"
                    >
                      <DropdownMenuGroup>
                        <DropdownMenuItem>
                          <PaperclipIcon />
                          Add Photos & Files
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem>
                          <ImageIcon />
                          Create Image
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <BinocularsIcon />
                          Deep Research
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <GlobeIcon />
                          Web Search
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {isBusy ? (
                    <InputGroupButton
                      type="button"
                      variant="default"
                      size="icon-sm"
                      className="ml-auto rounded-full"
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
                      className="ml-auto rounded-full"
                      aria-label="Send"
                    >
                      <ArrowUpIcon />
                      <span className="sr-only">Send</span>
                    </InputGroupButton>
                  )}
                </InputGroupAddon>
              </InputGroup>
            </form>
            </div>
          </footer>
        </div>
      </div>
    </MessageScrollerProvider>
  )
}
