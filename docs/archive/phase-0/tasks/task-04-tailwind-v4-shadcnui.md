# Phase 0 Task 4: Tailwind v4 + shadcn/ui 基础

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 519-672.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 4: Tailwind v4 + shadcn/ui 基础

**Files:**
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`
- Create: `src/renderer/styles/globals.css`
- Modify: `src/renderer/main.tsx`
- Create: `src/renderer/components/ui/button.tsx` (shadcn/ui copy-paste)
- Create: `src/renderer/lib/utils.ts`

- [ ] **Step 1: 装 Tailwind v4 + shadcn 依赖**

```bash
pnpm add -D tailwindcss@4 @tailwindcss/postcss postcss autoprefixer
pnpm add class-variance-authority clsx tailwind-merge lucide-react
```

- [ ] **Step 2: 写 postcss.config.js**

```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: 写 tailwind.config.ts (Tailwind v4 风格 - 大部分配置走 CSS)**

```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
} satisfies Config;
```

- [ ] **Step 4: 写 src/renderer/styles/globals.css (Tailwind v4 + shadcn tokens)**

```css
@import "tailwindcss";

@theme {
  --color-background: oklch(1 0 0);
  --color-foreground: oklch(0.15 0 0);
  --color-primary: oklch(0.55 0.13 145);
  --color-primary-foreground: oklch(0.99 0 0);
  --color-muted: oklch(0.96 0 0);
  --color-muted-foreground: oklch(0.45 0 0);
  --color-border: oklch(0.92 0 0);
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
}

@layer base {
  * { @apply border-border; }
  body { @apply bg-background text-foreground; font-family: system-ui, -apple-system, sans-serif; }
}
```

- [ ] **Step 5: 写 src/renderer/lib/utils.ts (shadcn 标配)**

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 6: 写 src/renderer/components/ui/button.tsx (shadcn/ui Button copy)**

```tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@renderer/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-border bg-transparent hover:bg-muted',
        ghost: 'hover:bg-muted',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-9 px-3',
        lg: 'h-11 px-6',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = 'Button';
```

```bash
pnpm add @radix-ui/react-slot
```

- [ ] **Step 7: 改 src/renderer/main.tsx 用 Tailwind + Button**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@renderer/components/ui/button';
import './styles/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <main className="p-8">
      <h1 className="text-2xl font-semibold">carbonbook</h1>
      <p className="mt-2 text-muted-foreground">Phase 0 — Tailwind + shadcn ready.</p>
      <Button className="mt-4">Hello</Button>
    </main>
  </StrictMode>,
);
```

- [ ] **Step 8: 跑 dev，确认 Button 渲染**

Run: `pnpm dev`
Expected: 主标题、副标题、绿色 Button 按钮，hover 变深。

- [ ] **Step 9: Commit**

```bash
git add tailwind.config.ts postcss.config.js src/renderer/styles/ src/renderer/lib/ src/renderer/components/ src/renderer/main.tsx package.json pnpm-lock.yaml
git commit -m "Phase 0/Task 4: Tailwind v4 + shadcn/ui Button baseline"
```

---

