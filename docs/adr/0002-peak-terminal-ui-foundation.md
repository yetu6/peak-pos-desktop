# ADR 0002: Peak Terminal UI foundation

- Status: Accepted
- Date: 2026-09-02
- Scope: Peak POS Desktop Phase 2 and later terminal UI work

## Decision

Peak POS Desktop uses its existing React/Vite frontend with Tailwind CSS and selectively copied shadcn/ui components backed by Radix primitives. Lucide is the standard icon library for new terminal primitives.

shadcn/ui is an accessible implementation foundation, not the product's visual identity. The Peak Terminal semantic tokens in `src/index.css` govern color, type, spacing, focus, touch targets, motion, and responsive geometry. Peak-specific operational components sit above that layer.

The terminal owns purpose-built components for product tiles, category navigation, order lines and rail, quantity controls, modifier sheets, tender choices, money display, operational and connectivity status, and terminal states. These components must not be expressed as walls of generic cards.

Radix dialogs and sheets provide focus management, keyboard behavior, portal layering, and modal semantics. Modifier flows prefer a side sheet to preserve order context. Centered dialogs remain appropriate for settlement, destructive confirmation, supervisor authorization, and concise irreversible decisions.

TanStack Table or TanStack Virtual may be introduced only when measured list size or interaction complexity justifies them. React Hook Form and Zod may be introduced only for forms that benefit from schema-driven validation. They are not baseline dependencies.

MUI, Ant Design, Chakra, Bootstrap, PrimeReact, and competing visual systems are not part of the V1 terminal stack.

## Boundaries

This decision changes presentation and interaction infrastructure only. React remains presentation-oriented. It does not gain pricing, money, offline order, cash-settlement, printing, or reconciliation authority. The locked Rust local transaction core remains the authority for offline-capable order and cash operations when that later phase is implemented.

## Consequences

- Accessible primitive behavior is reused without inheriting a generic SaaS appearance.
- Peak Terminal tokens remain the single visual contract for dark and optional light terminal themes.
- Operational components can be tuned for touch density, muscle memory, and the three-click principle.
- Generated shadcn components are source-owned and may be restyled to Peak semantics.
