"use client"

import { MoonIcon, SunIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"

const STORAGE_KEY = "grok-chat-theme"

function applyTheme(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark")
  localStorage.setItem(STORAGE_KEY, theme)
}

export function ThemeToggle() {
  function toggle() {
    const next = document.documentElement.classList.contains("dark")
      ? "light"
      : "dark"
    applyTheme(next)
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label="Toggle color theme"
    >
      <SunIcon className="hidden dark:block" />
      <MoonIcon className="dark:hidden" />
    </Button>
  )
}
